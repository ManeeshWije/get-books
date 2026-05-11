use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
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
