const transferCodeTtlMs = 5 * 60 * 1000;
const transferStorageKey = "active-transfer-codes";

export type TransferCodeEntry = {
    shortCode: string;
    createdAt: string;
};

export type TransferCodeMap = Record<string, TransferCodeEntry>;
export type PaginationItem = number | "ellipsis";

export function readTransferCodeMap(): TransferCodeMap {
    const rawValue = window.localStorage.getItem(transferStorageKey);
    if (rawValue === null) {
        return {};
    }

    try {
        const parsed: unknown = JSON.parse(rawValue);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return {};
        }

        const result: TransferCodeMap = {};

        for (const [md5, entry] of Object.entries(parsed)) {
            if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
                continue;
            }

            const shortCode = Reflect.get(entry, "shortCode");
            const createdAt = Reflect.get(entry, "createdAt");

            if (typeof shortCode === "string" && typeof createdAt === "string") {
                result[md5] = { shortCode, createdAt };
            }
        }

        return result;
    } catch {
        return {};
    }
}

export function writeTransferCodeMap(value: TransferCodeMap): void {
    window.localStorage.setItem(transferStorageKey, JSON.stringify(value));
}

export function getRemainingMs(entry: TransferCodeEntry, now: number): number {
    const createdAtTimestamp = Date.parse(entry.createdAt);
    if (!Number.isFinite(createdAtTimestamp)) {
        return 0;
    }

    return Math.max(0, createdAtTimestamp + transferCodeTtlMs - now);
}

export function formatRemainingTime(remainingMs: number): string {
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const paddedSeconds = seconds < 10 ? `0${seconds}` : `${seconds}`;

    return `${minutes}:${paddedSeconds}`;
}

export function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    if (currentPage <= 4) {
        return [1, 2, 3, 4, 5, "ellipsis", totalPages];
    }

    if (currentPage >= totalPages - 3) {
        return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }

    return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export function getDownloadFileName(contentDispositionHeader: string | null): string {
    if (contentDispositionHeader === null) {
        return "transfer-file";
    }

    const fileNameMatch = /filename="([^"]+)"/.exec(contentDispositionHeader);
    if (fileNameMatch === null) {
        return "transfer-file";
    }

    return fileNameMatch[1];
}

export function downloadBlob(blob: Blob, fileName: string): void {
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(objectUrl);
}

export function startDownloadFromUrl(downloadUrl: string): void {
    let validatedUrl: URL;

    try {
        validatedUrl = new URL(downloadUrl);
    } catch {
        throw new Error("Download URL is invalid");
    }

    window.location.assign(validatedUrl.toString());
}
