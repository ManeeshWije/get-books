mod cleanup;
mod error;
mod handlers;
use axum::{Router, routing::get};
use dotenv::dotenv;
use http::{
    HeaderValue, Method,
    header::{CONNECTION, CONTENT_DISPOSITION, CONTENT_TYPE, UPGRADE},
};
use std::{env, net::SocketAddr};
use tower_http::trace::{DefaultMakeSpan, TraceLayer};
use tower_http::{cors::CorsLayer, services::ServeDir};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
pub struct AppState {
    pub redis_pool: r2d2::Pool<redis::Client>,
    pub client: reqwest::Client,
    pub rapidapi_key: String,
}

#[tokio::main]
async fn main() {
    dotenv().ok();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let dist_dir = if cfg!(debug_assertions) {
        "../frontend/dist/"
    } else {
        "./dist"
    };

    let cors_origin = env::var("CLIENT_URL")
        .unwrap()
        .as_str()
        .parse::<HeaderValue>()
        .unwrap();

    let cors_middleware = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::PUT])
        .allow_origin(cors_origin)
        .allow_headers(vec![CONTENT_TYPE, UPGRADE, CONNECTION, CONTENT_DISPOSITION])
        .expose_headers(vec![CONTENT_DISPOSITION])
        .allow_credentials(true);

    let redis_url = env::var("REDIS_URL").expect("REDIS_URL must be set");
    let redis_client = redis::Client::open(redis_url).unwrap();

    let redis_pool = r2d2::Pool::builder().build(redis_client).unwrap();
    let client = reqwest::Client::new();
    let rapidapi_key = env::var("RAPIDAPI_KEY").expect("RAPIDAPI_KEY must be set");

    let state = AppState {
        redis_pool,
        client,
        rapidapi_key,
    };

    cleanup::spawn_temp_file_cleanup_task();

    let app = Router::new()
        .nest_service("/", ServeDir::new(dist_dir))
        .route("/search", get(handlers::search_handler))
        .route("/download", get(handlers::download_handler))
        .route("/start-transfer", get(handlers::start_transfer_handler))
        .route("/end-transfer", get(handlers::end_transfer_handler))
        .with_state(state)
        .layer(cors_middleware)
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::default().include_headers(true)),
        );

    let port = env::var("PORT")
        .unwrap_or_else(|_| "8080".to_string())
        .parse::<u16>()
        .expect("PORT must be a valid u16");

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .unwrap();
    tracing::debug!("listening on {}", listener.local_addr().unwrap());
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
