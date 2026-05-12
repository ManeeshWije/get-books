use axum::{
    Json,
    extract::{Query, State},
};
use redis::TypedCommands;
use serde::{Deserialize, Serialize};
use tiny_id::ShortCodeGenerator;
use tokio::io::AsyncWriteExt;
use typeshare::typeshare;

use crate::{AppState, error::AppError};

#[typeshare]
#[derive(Serialize, Deserialize)]
pub struct Book {
    title: String,
    author: String,
    md5: String,

    #[serde(rename = "imgUrl")]
    img_url: String,

    size: String,
    genre: String,
    format: String,
    year: Option<String>,

    #[serde(rename = "imgFallbackColor")]
    img_fallback_colour: String,
}

#[typeshare]
#[derive(Serialize, Deserialize)]
pub struct SearchResponse {
    #[serde(rename = "totalPages")]
    total_pages: u32,
    books: Vec<Book>,
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
    page: u32,
}

pub async fn search_handler(
    Query(search_query): Query<SearchQuery>,
    State(state): State<AppState>,
) -> Result<Json<SearchResponse>, AppError> {
    let request_url = format!(
        "https://annas-archive-api.p.rapidapi.com/search?q={}&page={}",
        search_query.q, search_query.page
    );

    let response = state
        .client
        .get(request_url)
        .header("x-rapidapi-host", "annas-archive-api.p.rapidapi.com")
        .header("x-rapidapi-key", state.rapidapi_key)
        .send()
        .await?
        .json::<SearchResponse>()
        .await?;

    Ok(Json(SearchResponse {
        total_pages: response.total_pages,
        books: response.books,
    }))
}

#[derive(Deserialize)]
pub struct DownloadQuery {
    md5: String,
}

pub async fn download_handler(
    Query(download_query): Query<DownloadQuery>,
    State(state): State<AppState>,
) -> Result<Json<String>, AppError> {
    let request_url = format!(
        "https://annas-archive-api.p.rapidapi.com/download?md5={}",
        download_query.md5
    );

    let response = state
        .client
        .get(request_url)
        .header("x-rapidapi-host", "annas-archive-api.p.rapidapi.com")
        .header("x-rapidapi-key", state.rapidapi_key)
        .send()
        .await?
        .json::<Vec<String>>()
        .await?;

    if let Some(url) = response.first() {
        Ok(Json(url.clone()))
    } else {
        Err(AppError(anyhow::anyhow!(
            "No download URL found for the given MD5 hash"
        )))
    }
}

#[typeshare]
#[derive(Serialize, Deserialize)]
pub struct StartTransferResponse {
    short_code: String,
    created_at: String,
}

pub async fn start_transfer_handler(
    Query(download_query): Query<DownloadQuery>,
    State(state): State<AppState>,
) -> Result<Json<StartTransferResponse>, AppError> {
    let request_url = format!(
        "https://annas-archive-api.p.rapidapi.com/download?md5={}",
        download_query.md5
    );

    let response = state
        .client
        .get(request_url)
        .header("x-rapidapi-host", "annas-archive-api.p.rapidapi.com")
        .header("x-rapidapi-key", state.rapidapi_key.clone())
        .send()
        .await?
        .json::<Vec<String>>()
        .await?;

    if let Some(url) = response.first() {
        let mut generator = ShortCodeGenerator::new_alphanumeric(6);
        let short_code = generator.next_string();

        let transfer_id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();

        // request the actual file
        let mut upstream_response = state.client.get(url).send().await?;

        // try to get filename from content-disposition header
        let original_file_name = upstream_response
            .headers()
            .get(reqwest::header::CONTENT_DISPOSITION)
            .and_then(|value| value.to_str().ok())
            .and_then(|content_disposition| {
                content_disposition
                    .split("filename=")
                    .nth(1)
                    .map(|s| s.trim_matches('"').to_string())
            })
            // fallback to URL parsing
            .unwrap_or_else(|| {
                url.split('/')
                    .last()
                    .unwrap_or("book.epub")
                    .split('?')
                    .next()
                    .unwrap_or("book.epub")
                    .to_string()
            });

        let final_file_name = if original_file_name.ends_with(".epub") {
            original_file_name.replace(".epub", ".kepub.epub")
        } else {
            format!("{}.kepub.epub", original_file_name)
        };

        // use kepubify binary to convert the file to kepub format on the fly as we write it to disk
        // our output file will be the same as the input file, but kepubify will overwrite it with
        // the converted file

        // temp paths
        let input_epub_path = format!("/tmp/{}.epub", transfer_id);

        let output_kepub_path = format!("/tmp/{}.kepub.epub", transfer_id);

        println!("Downloading file to: {}", input_epub_path);
        println!("Converted file will be at: {}", output_kepub_path);

        // write downloaded epub to disk
        let mut file = tokio::fs::File::create(&input_epub_path).await?;

        while let Some(chunk) = upstream_response.chunk().await? {
            tokio::io::AsyncWriteExt::write_all(&mut file, &chunk).await?;
        }

        file.flush().await?;

        // run kepubify
        let output = tokio::process::Command::new("kepubify")
            .arg("-o")
            .arg("/tmp")
            .arg(&input_epub_path)
            .output()
            .await?;

        println!(
            "kepubify stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        println!(
            "kepubify stdout: {}",
            String::from_utf8_lossy(&output.stdout)
        );

        if !output.status.success() {
            return Err(AppError(anyhow::anyhow!(
                "kepubify failed: {}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        println!(
            "kepubify output: {}",
            String::from_utf8_lossy(&output.stdout)
        );

        // remove original epub
        let _ = tokio::fs::remove_file(&input_epub_path).await;

        // store transfer info in redis
        let redis_value = serde_json::json!({
            "file_path": output_kepub_path,
            "file_name": final_file_name,
            "created_at": created_at,
        })
        .to_string();

        let mut redis_conn = state.redis_pool.get()?;

        redis_conn.set(&short_code, redis_value)?;

        redis_conn.expire_at(
            &short_code,
            (chrono::Utc::now() + chrono::Duration::minutes(5)).timestamp(),
        )?;

        Ok(Json(StartTransferResponse {
            short_code,
            created_at,
        }))
    } else {
        Err(AppError(anyhow::anyhow!(
            "No download URL found for the given MD5 hash"
        )))
    }
}

#[derive(Deserialize)]
pub struct ShortCodeQuery {
    short_code: String,
}

// this function will be called when a user submits a short code
// it will look up the short code in redis, ensure the transfer is stil valid (i.e. not expired and
// file still exists),
// it will then return the file as an attachment if the transfer is valid, otherwise it will return
// an error message
pub async fn end_transfer_handler(
    Query(short_code_query): Query<ShortCodeQuery>,
    State(state): State<AppState>,
) -> Result<axum::response::Response, AppError> {
    let mut redis_conn = state.redis_pool.get()?;

    let redis_value: String = redis_conn
        .get(&short_code_query.short_code)?
        .ok_or_else(|| {
            AppError(anyhow::anyhow!(
                "Invalid short code or transfer has expired"
            ))
        })?;

    let transfer_info: serde_json::Value = serde_json::from_str(&redis_value)?;

    let file_path = transfer_info["file_path"]
        .as_str()
        .ok_or_else(|| AppError(anyhow::anyhow!("Invalid transfer info stored in Redis")))?;

    let file_name = transfer_info["file_name"].as_str().unwrap_or("book.epub");

    // ensure file still exists
    if tokio::fs::metadata(file_path).await.is_err() {
        return Err(AppError(anyhow::anyhow!(
            "The file for this transfer is no longer available"
        )));
    }

    let file = tokio::fs::File::open(file_path).await?;

    let stream = tokio_util::io::ReaderStream::new(file);

    let body = axum::body::Body::from_stream(stream);

    Ok(axum::response::Response::builder()
        .header(
            "Content-Disposition",
            format!("attachment; filename=\"{}\"", file_name),
        )
        .header("Content-Type", "application/octet-stream")
        .body(body)
        .unwrap())
}
