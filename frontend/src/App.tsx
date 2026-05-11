import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Book, SearchResponse } from "./types";

const API_URL = import.meta.env.MODE === "production" ? "" : "http://localhost:8080";
const transferCodeTtlMs = 10 * 60 * 1000;
const transferStorageKey = "active-transfer-codes";

type TransferCodeEntry = {
    code: string;
    createdAt: number;
};

type TransferCodeMap = Record<string, TransferCodeEntry>;

function readTransferCodeMap(): TransferCodeMap {
    const rawValue = window.localStorage.getItem(transferStorageKey);
    if (rawValue === null) {
        return {};
    }

    try {
        const parsed = JSON.parse(rawValue);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return {};
        }

        const result: TransferCodeMap = {};

        for (const [md5, entry] of Object.entries(parsed)) {
            if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
                continue;
            }

            const code = Reflect.get(entry, "code");
            const createdAt = Reflect.get(entry, "createdAt");

            if (typeof code === "string" && typeof createdAt === "number" && Number.isFinite(createdAt)) {
                result[md5] = { code, createdAt };
            }
        }

        return result;
    } catch {
        return {};
    }
}

function writeTransferCodeMap(value: TransferCodeMap): void {
    window.localStorage.setItem(transferStorageKey, JSON.stringify(value));
}

function createTransferCode(): string {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const randomValues = new Uint32Array(6);
    window.crypto.getRandomValues(randomValues);

    let result = "";
    for (const value of randomValues) {
        result += alphabet[value % alphabet.length];
    }

    return result;
}

function getRemainingMs(entry: TransferCodeEntry, now: number): number {
    return Math.max(0, entry.createdAt + transferCodeTtlMs - now);
}

function formatRemainingTime(remainingMs: number): string {
    const totalSeconds = Math.ceil(remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const paddedSeconds = seconds < 10 ? `0${seconds}` : `${seconds}`;

    return `${minutes}:${paddedSeconds}`;
}

type PaginationItem = number | "ellipsis";

function buildPaginationItems(currentPage: number, totalPages: number): PaginationItem[] {
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

async function fetchBooksByTitle(query: string, page: number): Promise<SearchResponse> {
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

type BookCardProps = {
    book: Book;
    transferEntry: TransferCodeEntry | undefined;
    remainingMs: number;
    onRequestTransfer: (md5: string) => void;
};

function BookCard({ book, transferEntry, remainingMs, onRequestTransfer }: BookCardProps) {
    const [imageFailed, setImageFailed] = useState(false);
    const isTransferActive = transferEntry !== undefined && remainingMs > 0;

    return (
        <li className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 rounded-xl border border-slate-700/80 bg-slate-950/60 p-3">
            <div
                className="grid aspect-2/3 w-23 place-items-center overflow-hidden rounded-lg border border-white/15"
                style={{ backgroundColor: book.imgFallbackColor }}
            >
                {!imageFailed && book.imgUrl.length > 0 ? (
                    <img
                        src={book.imgUrl}
                        alt={`${book.title} cover`}
                        loading="lazy"
                        className="h-full w-full object-cover"
                        onError={() => setImageFailed(true)}
                    />
                ) : (
                    <span className="text-3xl font-bold text-white/90">{book.title.slice(0, 1).toUpperCase()}</span>
                )}
            </div>

            <div className="min-w-0">
                <h2 className="m-0 text-base font-semibold text-slate-50">{book.title}</h2>
                <p className="mb-2 mt-1 text-sm text-slate-400">{book.author}</p>

                <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <div className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-slate-500">Year</dt>
                        <dd className="m-0 text-sm text-slate-200">{book.year ?? "-"}</dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-slate-500">Format</dt>
                        <dd className="m-0 text-sm text-slate-200">{book.format}</dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-slate-500">Genre</dt>
                        <dd className="m-0 text-sm text-slate-200">{book.genre}</dd>
                    </div>
                    <div className="min-w-0">
                        <dt className="text-[11px] uppercase tracking-wide text-slate-500">Size</dt>
                        <dd className="m-0 text-sm text-slate-200">{book.size}</dd>
                    </div>
                </dl>

                <div className="mt-3 flex flex-wrap gap-2">
                    <button
                        type="button"
                        className="rounded-md border border-indigo-400/40 bg-indigo-400/15 px-3 py-1.5 text-xs font-medium text-indigo-100 transition hover:border-indigo-300/70 hover:bg-indigo-400/25"
                    >
                        Download
                    </button>

                    {isTransferActive && transferEntry !== undefined ? (
                        <div className="inline-flex items-center gap-2 rounded-md border border-teal-400/40 bg-teal-400/15 px-3 py-1.5 text-xs font-medium text-teal-100">
                            <span className="font-mono tracking-widest">{transferEntry.code}</span>
                            <span className="text-teal-200/90">{formatRemainingTime(remainingMs)}</span>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onRequestTransfer(book.md5)}
                            className="rounded-md border border-teal-400/40 bg-teal-400/15 px-3 py-1.5 text-xs font-medium text-teal-100 transition hover:border-teal-300/70 hover:bg-teal-400/25"
                        >
                            Transfer to Kobo
                        </button>
                    )}
                </div>
            </div>
        </li>
    );
}

function App() {
    const [searchInput, setSearchInput] = useState("");
    const [submittedQuery, setSubmittedQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [transferCodeInput, setTransferCodeInput] = useState("");
    const [activeTransferCodes, setActiveTransferCodes] = useState<TransferCodeMap>(() => readTransferCodeMap());
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => {
            setNow(Date.now());
        }, 1000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    useEffect(() => {
        setActiveTransferCodes(previousValue => {
            let changed = false;
            const nextValue: TransferCodeMap = {};

            for (const [md5, entry] of Object.entries(previousValue)) {
                if (getRemainingMs(entry, now) > 0) {
                    nextValue[md5] = entry;
                } else {
                    changed = true;
                }
            }

            if (!changed) {
                return previousValue;
            }

            return nextValue;
        });
    }, [now]);

    useEffect(() => {
        writeTransferCodeMap(activeTransferCodes);
    }, [activeTransferCodes]);

    const {
        data: searchResponse,
        error,
        isFetching
    } = useQuery<SearchResponse, Error>({
        queryKey: ["search", submittedQuery, currentPage],
        queryFn: () => fetchBooksByTitle(submittedQuery, currentPage),
        enabled: submittedQuery.length > 0,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        staleTime: Number.POSITIVE_INFINITY
    });

    const books = searchResponse?.books ?? [];
    const totalPages = searchResponse?.totalPages ?? 0;
    const paginationItems = buildPaginationItems(currentPage, totalPages);

    const handleStartTransfer = (md5: string): void => {
        setActiveTransferCodes(previousValue => ({
            ...previousValue,
            [md5]: {
                code: createTransferCode(),
                createdAt: Date.now()
            }
        }));
    };

    const handleSubmitSearch = (event: React.SubmitEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const nextQuery = searchInput.trim();
        setCurrentPage(1);
        setSubmittedQuery(nextQuery);
    };

    return (
        <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1b1f2b_0%,#0f1117_45%,#090a0f_100%)] text-slate-200">
            <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8">
                <section className="flex w-full flex-1 items-center">
                    <div className="mx-auto w-full max-w-5xl text-center">
                        <h1 className="mb-5 text-3xl font-semibold text-slate-50 sm:text-4xl">Find your next book</h1>
                        <form role="search" className="flex gap-2" onSubmit={handleSubmitSearch}>
                            <label htmlFor="book-title" className="sr-only">
                                Book title
                            </label>
                            <input
                                id="book-title"
                                type="search"
                                autoComplete="off"
                                spellCheck={false}
                                placeholder="Search by title..."
                                value={searchInput}
                                onChange={event => setSearchInput(event.target.value)}
                                className="w-full rounded-full border border-slate-700 bg-slate-950/90 px-5 py-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-3 focus:ring-indigo-400/20"
                            />
                            <button
                                type="submit"
                                className="rounded-full border border-indigo-400/40 bg-indigo-400/15 px-5 py-3 text-sm font-medium text-indigo-100 transition hover:border-indigo-300/70 hover:bg-indigo-400/25"
                            >
                                Search
                            </button>
                        </form>

                        <div className="mt-4 text-left">
                            {isFetching && <p className="text-center text-slate-400">Loading...</p>}

                            {error instanceof Error && <p className="text-center text-rose-300">{error.message}</p>}

                            {!isFetching && !error && searchResponse !== undefined && books.length === 0 && (
                                <p className="text-center text-slate-400">No books found.</p>
                            )}

                            {books.length > 0 && (
                                <>
                                    <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
                                        {books.map(book => {
                                            const transferEntry = activeTransferCodes[book.md5];
                                            const remainingMs =
                                                transferEntry === undefined ? 0 : getRemainingMs(transferEntry, now);

                                            return (
                                                <BookCard
                                                    key={book.md5}
                                                    book={book}
                                                    transferEntry={transferEntry}
                                                    remainingMs={remainingMs}
                                                    onRequestTransfer={handleStartTransfer}
                                                />
                                            );
                                        })}
                                    </ul>

                                    {totalPages > 1 && (
                                        <nav
                                            className="mt-5 flex flex-wrap items-center justify-center gap-2"
                                            aria-label="Pagination"
                                        >
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setCurrentPage(previousPage => Math.max(1, previousPage - 1))
                                                }
                                                disabled={currentPage === 1 || isFetching}
                                                className="rounded-md border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                Prev
                                            </button>

                                            {paginationItems.map((item, index) =>
                                                item === "ellipsis" ? (
                                                    <span key={`ellipsis-${index}`} className="px-2 text-slate-500">
                                                        ...
                                                    </span>
                                                ) : (
                                                    <button
                                                        key={item}
                                                        type="button"
                                                        onClick={() => setCurrentPage(item)}
                                                        disabled={isFetching || item === currentPage}
                                                        className="rounded-md border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-70"
                                                        style={{
                                                            borderColor:
                                                                item === currentPage
                                                                    ? "rgba(99, 102, 241, 0.7)"
                                                                    : "rgba(71, 85, 105, 0.9)",
                                                            backgroundColor:
                                                                item === currentPage
                                                                    ? "rgba(99, 102, 241, 0.25)"
                                                                    : "rgba(15, 23, 42, 0.65)",
                                                            color: item === currentPage ? "#c7d2fe" : "#e2e8f0"
                                                        }}
                                                    >
                                                        {item}
                                                    </button>
                                                )
                                            )}

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setCurrentPage(previousPage =>
                                                        Math.min(totalPages, previousPage + 1)
                                                    )
                                                }
                                                disabled={currentPage === totalPages || isFetching}
                                                className="rounded-md border border-slate-600 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-200 transition hover:border-slate-500 hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                Next
                                            </button>
                                        </nav>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </section>

                <aside className="fixed right-4 top-4 z-20 w-[min(22rem,calc(100vw-2rem))]">
                    <div className="w-full rounded-xl border border-slate-700/70 bg-slate-950/85 p-3 backdrop-blur">
                        <p className="text-sm text-slate-300">Enter transfer code</p>
                        <form className="mt-2 flex items-center gap-2" onSubmit={event => event.preventDefault()}>
                            <label htmlFor="kobo-transfer-code" className="sr-only">
                                Transfer code
                            </label>
                            <input
                                id="kobo-transfer-code"
                                type="text"
                                autoComplete="off"
                                placeholder="Short code"
                                value={transferCodeInput}
                                onChange={event => setTransferCodeInput(event.target.value)}
                                className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950/90 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none focus:ring-3 focus:ring-indigo-400/20"
                            />
                            <button
                                type="submit"
                                className="rounded-md border border-slate-500/50 bg-slate-800/90 px-3 py-2 text-sm text-slate-100 transition hover:border-slate-400 hover:bg-slate-700/90"
                            >
                                Submit
                            </button>
                        </form>
                    </div>
                </aside>

                <footer className="pt-2 text-center text-sm text-slate-400">
                    made with ❤️ by{" "}
                    <a
                        href="https://github.com/ManeeshWije"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-200 hover:underline focus-visible:underline"
                    >
                        Maneesh
                    </a>
                </footer>
            </main>
        </div>
    );
}

export default App;
