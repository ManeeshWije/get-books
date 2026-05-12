import type { SearchResponse, StartTransferResponse } from "./types";
import { downloadBlob, getDownloadFileName } from "./utils";

const API_URL = import.meta.env.MODE === "production" ? "" : "http://localhost:8080";

export async function fetchBooksByTitle(query: string, page: number): Promise<SearchResponse> {
    const searchParams = new URLSearchParams({ q: query, page: `${page}` });

    const response = await fetch(`${API_URL}/search?${searchParams.toString()}`, {
        headers: {
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        throw new Error(`Search failed (${response.status})`);
    }

    const searchResponse: SearchResponse = await response.json();
    return searchResponse;
}

export async function fetchDownloadUrl(md5: string): Promise<string> {
    const searchParams = new URLSearchParams({ md5 });

    const response = await fetch(`${API_URL}/download?${searchParams.toString()}`, {
        headers: {
            Accept: "text/plain, application/json"
        }
    });

    if (!response.ok) {
        throw new Error(`Download failed (${response.status})`);
    }

    const rawValue = (await response.text()).trim();
    if (rawValue.length === 0) {
        throw new Error("Download URL is empty");
    }

    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
        try {
            const parsedValue: unknown = JSON.parse(rawValue);
            if (typeof parsedValue === "string") {
                return parsedValue;
            }
        } catch {
            return rawValue.slice(1, -1);
        }
    }

    return rawValue;
}

export async function startTransfer(md5: string): Promise<StartTransferResponse> {
    const searchParams = new URLSearchParams({ md5 });

    const response = await fetch(`${API_URL}/start-transfer?${searchParams.toString()}`, {
        headers: {
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        throw new Error(`Transfer start failed (${response.status})`);
    }

    const payload: StartTransferResponse = await response.json();
    return payload;
}

export async function endTransfer(shortCode: string): Promise<void> {
    const searchParams = new URLSearchParams({ short_code: shortCode });

    const response = await fetch(`${API_URL}/end-transfer?${searchParams.toString()}`, {
        headers: {
            Accept: "application/octet-stream, application/json"
        }
    });

    if (!response.ok) {
        throw new Error(`Transfer submit failed (${response.status})`);
    }

    const blob = await response.blob();
    if (blob.size === 0) {
        throw new Error("Transfer download is empty");
    }

    const fileName = getDownloadFileName(response.headers.get("content-disposition"));
    downloadBlob(blob, fileName);
}
