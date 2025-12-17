"use client"

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ArrowLeft, ArrowRight, ArrowBigDownDash, ArrowUpDown, TextIcon, MoveIcon } from "lucide-react"
import OrderBar from "@/components/order-bar"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import TocBar from "@/components/toc-bar"

//TODO:
// ZILPRESOURCE -> ZTOPICDEFINITION & ZISSUE //how to figure out to whom a singe page in resource belongs use 
// ZILPTOPICPRODUCT -> ZISSUEPRODUCT is the same as the above and links to ZEPRODUCT
// ZILPTOPIC -> most important, shows pagenumber and also has ZTOPICDEFINITION & ZISSUE
// ZILPCOURSEDEF -> contains all downloaded courses

// ZILPTOPIC contains pagenumber and if it was deleted and ZTOPICDEFINITION WHICH can be found in ZILPRESOURCE to identify the chapter.
// ZILPCOURSEDEF = installed books

//ZILPPERMISSIONTYPEDEFINITION contains permissions definitions for dev envirnoment and even pdf download.

//ZISSUE IS A TOPIC GROUP OF A BOOK OR CHAPTER


// ##############################################################################
// ##############################################################################
// ##############################################################################
////
//// THE ZISSUE NUMBER IS THE MOST IMPORTANT! EACH BOOKS CHAPTER HAS A NUMBER
//// ITS A CHAPTER NUMBER! WITH THIS NUMBER I CAN TIE THE BOOK TO EACH PAGE
////
// ##############################################################################
// ##############################################################################
// ##############################################################################

type Book = {
    BookID: string;
    Titel: string;
    CourseName: string;
    Refrence: string;
    Issue: number[];
    Lang: string;
    Toggled: boolean;
};

type ProfileInfo = {
    id: string;
    label: string;
    selectable: boolean;
};

export default function BookReader() {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string>('');
    const [currentPage, setCurrentPage] = useState(1);
    const [maxPage, setMaxPage] = useState(1);
    const [isProgressVisible, setIsProgressVisible] = useState(false);
    const [progressClient, setProgressClient] = useState(0);
    const [muteEvent, setMuteEvent] = useState(false);
    const [tocHtml, setTocHtml] = useState<{ id: string; content: React.ReactNode }[]>([]);
    const pageIframeSrc = useMemo(() => buildIframeSrc(content), [content]);
    const [jobId, setJobId] = useState<string | null>(null);
    const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
    const [profilesLoading, setProfilesLoading] = useState<boolean>(true);
    const [currentProfile, setCurrentProfile] = useState<string>('');
    const [noBooks, setNoBooks] = useState<boolean>(false);
    const [books, setBooks] = useState<Book[]>([]);
    const [orderBarItems, setOrderBarItems] = useState<{ id: string; content: React.ReactNode }[]>([]); // TODO: maybe remove, books already beeing reordered, only here for img
    const [downloadError, setDownloadError] = useState(false);

    const [generateTocPages, setGenerateTocPages] = useState(true);
    const [exportQuiz, setExportQuiz] = useState(true);
    const [exportMyQuiz, setExportMyQuiz] = useState(false);

    const allBooksToggled = orderBarItems.length > 0 && orderBarItems.every(item => books.find(b => b.BookID === item.id)?.Toggled);
    const someBooksToggled = orderBarItems.some(item => books.find(b => b.BookID === item.id)?.Toggled);

    const muteEventRef = useRef(muteEvent);

    useEffect(() => {
        muteEventRef.current = muteEvent;
    }, [muteEvent]);

    // Load config + profiles on mount, and set initial profile (default should be "1")
    useEffect(() => {
        const initProfiles = async () => {
            try {
                setProfilesLoading(true);
                const cfgRes = await fetch("/api/config");
                const cfgData = await cfgRes.json();

                const selected = cfgRes.ok && cfgData?.success
                    ? (cfgData.config?.selectedProfile?.toString() || "1")
                    : "1";

                const profRes = await fetch("/api/profiles");
                const profData = await profRes.json();

                const list: ProfileInfo[] = profRes.ok && profData?.success
                    ? (profData.profiles || [])
                    : [];

                const selectable = list.filter((p) => p.selectable);
                setProfiles(selectable);

                // If selected is not selectable, pick the first selectable profile
                const selectedIsSelectable = selectable.some((p) => p.id === selected);

                const effective = selectedIsSelectable
                    ? selected
                    : (selectable[0]?.id || selected);

                if (effective !== selected) {
                    await fetch("/api/config", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ selectedProfile: effective }),
                    });
                }

                setCurrentProfile(effective);
            } catch (e) {
                console.error("Failed to init profiles:", e);
                setCurrentProfile("1");
            } finally {
                setProfilesLoading(false);
            }
        };

        initProfiles();
    }, []);

    useEffect(() => {
        const jobId = crypto.randomUUID();
        setJobId(jobId);
        setProgressClient(0);

        const eventSource = new EventSource(`/api/pdfProgress?jobId=${jobId}`);

        eventSource.onmessage = (event) => {
            if (!muteEventRef.current) {
                const progress = parseInt(event.data);
                setProgressClient(progress);
            };
        };

        return () => {
            eventSource.close();
        };
    }, []);

    useEffect(() => {
        const getBooks = async () => {
            if (!currentProfile) return;
            if (noBooks) {
                // If this profile has no books, make sure related UI state is cleared
                setBooks([]);
                setOrderBarItems([]);
                setTocHtml([]);
                return;
            }
            try {
                const response = await fetch(`/api/getBooks`);
                if (!response.ok) {
                    throw new Error('Failed to fetch books');
                }

                const { booklist, booksymbols } = await response.json();

                setBooks(booklist);

                // Convert booksymbols array to items
                const items = booksymbols.map((book: any) => ({
                    id: book.BookID,
                    content: (
                        <img
                            key={book.BookID}
                            src={book.SymbolImg || '/fallback-icon.png'}
                            alt={book.CourseName}
                            width={30}
                            height={30}
                            style={{ objectFit: 'contain' }}
                        />
                    ),
                }));

                setOrderBarItems(items);
            } catch (error) {
                console.error('Error fetching books:', error);
            }
        };
        getBooks();

        // Fetch last page number from ZTOPIC
        const fetchMaxPage = async () => {
            if (!currentProfile) return;
            try {
                // If ZILPRESOURCE is empty, the profile has no downloaded books/resources.
                // In that case, show a friendly message in the iframe instead of erroring.
                const maxResPk = await fetchMaxIntCol("Z_PK", "ZILPRESOURCE");
                if (!maxResPk.content || maxResPk.content <= 0) {
                    setNoBooks(true);
                    setError('');
                    setMaxPage(1);
                    setContent(buildNoBooksHtml());
                    setLoading(false);
                    return;
                }

                setNoBooks(false);
                const maxTopic = await fetchMaxIntCol("ZTOPIC", "ZILPRESOURCE");

                if (maxTopic.content > 0) {
                    setMaxPage(maxTopic.content);
                } else {
                    console.warn('Could not fetch max page, using fallback: 1');
                }
            } catch (err) {
                console.error('Error fetching max topic:', err);
            }
        };
        fetchMaxPage();
    }, [currentProfile, noBooks]);

    useEffect(() => {
        // Fetch TOC Entries Dynamically
        const fetchTOCEntries = async () => {
            try {
                const response = await fetch(`/api/getTOCEntries`);
                if (!response.ok) {
                    throw new Error('Failed to fetch TOC entries');
                }
                const { entries } = await response.json();
                const bookTOCs = generateTOCHtml(entries);
                setTocHtml(bookTOCs);
            } catch (error) {
                console.error('Error fetching TOC entries:', error);
            }
        };

        // Trigger TOC Fetch on MaxPage / books change
        if (!noBooks && maxPage > 0 && books.length > 0) {
            fetchTOCEntries();
        } else if (noBooks) {
            setTocHtml([]);
        }
    }, [books, maxPage, noBooks]);

    //TODO remove log
    useEffect(() => {
        console.log("Logging books toggle state:");
        Object.entries(books).forEach(([key, book]) => {
            console.log(`Book key = ${key}; BookID = ${book.BookID}; Toggled = ${book.Toggled};`);
        });
    }, [books]);

    // Function to toggle muteEvent
    const toggleMuteEvent = () => {
        setMuteEvent(prev => !prev);
    };

    const toggleAllBooks = (checked: boolean) => {
        setBooks(prev => prev.map(book => ({ ...book, Toggled: checked })));
    };

    const toggleSingleBook = (id: string) => {
        setBooks(prev =>
            prev.map(book =>
                book.BookID === id ? { ...book, Toggled: !book.Toggled } : book
            )
        );
    };

    const generateTOCHtml = (entries: any[]): { id: string; content: React.ReactNode }[] => {
        return books.map(book => {
            const matchingEntries = entries.filter(entry =>
                book.Issue.includes(entry.zIssue)
            );

            matchingEntries.sort((a, b) => {
                if (a.zIssue !== b.zIssue) return a.zIssue - b.zIssue;
                if (a.pagenum !== b.pagenum) return a.pagenum - b.pagenum;
                if (a.zOrder !== b.zOrder) return a.zOrder - b.zOrder;
                return (a.chapterSection || '').localeCompare(b.chapterSection || '');
            });
            const content = (
                <div style={{ width: '100%', padding: 0, margin: 0, boxSizing: 'border-box' }}>
                    <h2 style={{ fontSize: '0.9em' }}>{book.Titel}</h2>
                    <div style={{ fontSize: '0.7em', lineHeight: '2em' }}>
                        {(() => {
                            const tocElements = [];
                            let i = 0;

                            const createEntryElement = (e: any) => (
                                <div
                                    key={`${e.zpk}`}
                                    style={{
                                        position: 'relative',
                                        fontWeight: e.zLevel === 1 ? 'bold' : 'normal',
                                        marginLeft: `${(e.zLevel - 1) * 20}px`,
                                        paddingRight: '3rem', // space reserved for the page number
                                    }}
                                >
                                    <a
                                        href={`#${e.chapterSection?.replace(/\s+/g, '-').toLowerCase()}`}
                                        style={{ display: 'inline' }}
                                    >
                                        {e.chapterSection} {e.title}
                                    </a>
                                    <span
                                        style={{
                                            position: 'absolute',
                                            right: 0,
                                            bottom: 0,
                                        }}
                                    >
                                        {e.pagenum}
                                    </span>
                                </div>
                            );

                            while (i < matchingEntries.length) {
                                const entry = matchingEntries[i];

                                // Detect if current entry starts a block
                                const startsBlock =
                                    entry.zLevel >= 2 &&
                                    i + 1 < matchingEntries.length &&
                                    matchingEntries[i + 1].zLevel >= entry.zLevel;

                                if (startsBlock) {
                                    const blockElements = [];
                                    const currentZLevel = entry.zLevel;
                                    let j = i;

                                    while (
                                        j < matchingEntries.length &&
                                        matchingEntries[j].zLevel >= currentZLevel
                                    ) {
                                        blockElements.push(createEntryElement(matchingEntries[j]));

                                        const next = matchingEntries[j + 1];
                                        if (!next || next.zLevel <= 2) break;

                                        j++;
                                    }

                                    // Look ahead: does the next entry start another block at zLevel 2?
                                    const nextBlockStarts =
                                        matchingEntries[j + 1] &&
                                        matchingEntries[j + 1].zLevel >= 2 &&
                                        matchingEntries[j + 1].zLevel <= currentZLevel;

                                    tocElements.push(
                                        <div
                                            key={`block-${entry.zpk}`}
                                            style={{
                                                lineHeight: '1em',
                                                ...(nextBlockStarts ? { marginBottom: '0.5em' } : {}),
                                            }}
                                        >
                                            {blockElements}
                                        </div>
                                    );

                                    i = j + 1; // Move index past the block
                                } else {
                                    tocElements.push(createEntryElement(entry));
                                    i++;
                                }
                            }

                            return tocElements;
                        })()}
                    </div>
                </div>
            );

            return {
                id: book.BookID,
                content,
            };
        });
    };

    // Listen for Messages from TOC Iframe
    useEffect(() => {
        const handleMessage = (event: MessageEvent<any>) => {
            if (event.data?.page !== undefined) {
                const newPage = parseInt(event.data.page, 10);
                if (!isNaN(newPage) && newPage >= 1 && newPage <= maxPage) {
                    setCurrentPage(newPage);
                }
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [maxPage]);

    // Helper: Find the next valid page
    const findValidPage = async (startPage: number, direction: 'next' | 'prev'): Promise<number | null> => {
        const step = direction === 'next' ? 1 : -1;
        const limit = maxPage;

        for (let page = startPage; page >= 1 && page <= limit; page += step) {
            const { content } = await fetchWebResources("ZTOPIC", "ZTOPIC", page, "ZILPRESOURCE");
            if (content !== "") {
                return page;
            }
        }

        return null;
    };

    const loadIframe = async () => {
        try {
            const completeHtml = await fetchContentAndSetSrc(currentPage);

            setContent(completeHtml);
            setLoading(false);
        } catch (error) {
            console.error('Error fetching resources:', error);
            setError('Failed to load content');
            setLoading(false);
        }
    };

    // main content loading logic
    useEffect(() => {
        if (noBooks) {
            setError('');
            setContent(buildNoBooksHtml());
            setLoading(false);
            return;
        }
        if (!currentProfile) return;
        loadIframe();
    }, [currentPage, currentProfile, noBooks]);

    const nextPage = async () => {
        const nextValidPage = await findValidPage(currentPage + 1, 'next');
        if (nextValidPage !== null) {
            setCurrentPage(nextValidPage);
        } else {
            setCurrentPage(1);
        }
    };

    const pageBack = async () => {
        const prevValidPage = await findValidPage(currentPage - 1, 'prev');
        if (prevValidPage !== null && prevValidPage >= 1) {
            setCurrentPage(prevValidPage);
        } else {
            setCurrentPage(maxPage);
        }
    };

    if (loading) {
        return <div>Loading...</div>;
    }

    if (error) {
        return <div>Error: {error}</div>;
    }

    // generate a PDF serverside
    const generatePDF = async () => {
        // Check if any books are selected
        const selectedBooks = books.filter(book => book.Toggled);
        if (selectedBooks.length === 0) {
            // Flash button red to indicate error
            setDownloadError(true);
            setTimeout(() => setDownloadError(false), 1000);
            return;
        }

        try {
            setMuteEvent(false);
            setProgressClient(0);
            setIsProgressVisible(true);

            const responsepdf = await fetch(
                `/api/generatePdf?jobId=${jobId}&books=${encodeURIComponent(JSON.stringify(books))}` +
                `&generateTocPages=${generateTocPages}&exportQuiz=${exportQuiz}&exportMyQuiz=${exportMyQuiz}`
            );
            if (!responsepdf.ok) throw new Error('Failed to generate PDF');

            const blob = await responsepdf.blob();
            toggleMuteEvent();
            setProgressClient(98);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            setProgressClient(99);
            a.href = url;
            a.download = 'book.pdf';
            setProgressClient(100);
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('PDF generation failed:', error);
        }
    };

    return (
        <div>
            <div className="flex justify-center space-x-4 mb-4">
                <Button
                    variant="outline"
                    onClick={() => generatePDF()}
                    type="button"
                    className={`transition-all duration-300 ${downloadError ? 'border-red-500 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : ''}`}
                >
                    <ArrowBigDownDash></ArrowBigDownDash>Download
                </Button>
                <div className="w-full flex items-center justify-center gap-3">
                    {isProgressVisible && <><Progress
                        value={progressClient}
                        className="transition duration-700 ease-in-out ..." /><span className="text-sm">{progressClient}%</span></>
                    }
                </div>
                <Select
                    value={currentProfile}
                    onValueChange={async (value) => {
                        try {
                            setLoading(true);
                            // Persist selection first so backend requests read the right DB
                            await fetch("/api/config", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ selectedProfile: value }),
                            });
                            setCurrentProfile(value);
                            setCurrentPage(1);
                        } catch (e) {
                            console.error("Failed to switch profile:", e);
                        }
                    }}
                    disabled={profilesLoading}
                >
                    <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Select a Profile" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectLabel>Profiles</SelectLabel>
                            {(profiles.length ? profiles : [{ id: currentProfile || "1", label: currentProfile || "1", selectable: true }]).map((p) => (
                                <SelectItem key={p.id} value={p.id} disabled={!p.selectable}>
                                    {p.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
                <Button variant="outline"
                    onClick={pageBack}
                    type="button"
                >
                    <ArrowLeft></ArrowLeft>
                </Button>
                <Button variant="outline"
                    onClick={nextPage}
                    type="button"
                >
                    <ArrowRight></ArrowRight>
                </Button>
            </div>
            <div className="flex flex-row w-full">
                <div className="flex flex-col flex-1 gap-4">
                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-3">
                            <Checkbox
                                id="books"
                                checked={allBooksToggled}
                                onCheckedChange={(checked) => toggleAllBooks(!!checked)}
                                {...(!allBooksToggled && someBooksToggled ? { indeterminate: "true" } : {})}
                            />
                            <Label htmlFor="books">Enable all books for download</Label>
                        </div>

                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="generateTocPages"
                                checked={generateTocPages}
                                onCheckedChange={(checked) => setGenerateTocPages(!!checked)}
                            />
                            <Label htmlFor="generateTocPages">Generate table of contents pages</Label>
                        </div>

                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="exportQuiz"
                                checked={exportQuiz}
                                onCheckedChange={(checked) => setExportQuiz(!!checked)}
                            />
                            <Label htmlFor="exportQuiz">Export quiz</Label>
                        </div>

                        {/* TODO: add feature
                        <div className="flex items-center gap-2">
                            <Checkbox
                                id="exportMyQuiz"
                                checked={exportMyQuiz}
                                onCheckedChange={(checked) => setExportMyQuiz(!!checked)}
                            />
                            <Label htmlFor="exportMyQuiz">Export my quiz</Label>
                        </div>*/}
                    </div>
                    <div className="flex flex-row gap-2">
                        <div className="inline-block">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <OrderBar
                                        items={orderBarItems.map(item => ({
                                            ...item,
                                            toggled: books.find(b => b.BookID === item.id)?.Toggled || false
                                        }))}
                                        onToggle={toggleSingleBook}
                                        onReorder={(newOrder) => {
                                            // Reorder books array based on the new order of items
                                            const reorderedBooks = newOrder.map(item =>
                                                books.find(book => book.BookID === item.id)
                                            ).filter(Boolean) as Book[];

                                            // Add any books that might not be in the order bar
                                            const booksNotInOrderBar = books.filter(book =>
                                                !newOrder.some(item => item.id === book.BookID)
                                            );

                                            setBooks([...reorderedBooks, ...booksNotInOrderBar]);
                                            setOrderBarItems(newOrder);
                                        }}
                                        highlightError={downloadError}
                                    />
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Enable & Order</p>
                                </TooltipContent>
                            </Tooltip>
                        </div>

                        <div className="flex flex-col flex-1 h-full">
                            {/* TODO: BUG: TocBar doesn't update properly the first time (is shown for 1 sec and then disappears, when site updates
                               for example because of a download start, it showns properly ), was this comment meant for orderbar?*/}
                            <TocBar
                                items={orderBarItems.map(item => {
                                    const tocEntry = tocHtml.find(t => t.id === item.id);
                                    const book = books.find(b => b.BookID === item.id);

                                    return {
                                        id: item.id,
                                        title: book?.Titel || book?.CourseName || "(Unknown book)",
                                        content: tocEntry?.content || <div>No TOC available</div>,
                                        toggled: book?.Toggled || false,
                                    };
                                })}
                            />
                        </div>
                    </div>
                </div>
                <div className="w-1"></div>
                <iframe
                    id="page-iframe"
                    className="w-3/4 h-[800px] border-none" // TODO: remove fixed size
                    title="Book Reader"
                    src={pageIframeSrc}
                    allowFullScreen
                    width="100%"
                    height="400px"
                    style={{
                        border: 'none',
                        borderRadius: '8px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                />
            </div>
        </div >
    );
}

const fetchContentAndSetSrc = async (pageNumber: number) => {
    const { content: resulthtmlId } = await fetchWebResources("Z_PK", "ZTOPIC", pageNumber, "ZILPRESOURCE");
    const htmlId = typeof resulthtmlId === "number" ? resulthtmlId : parseInt(String(resulthtmlId || "0"), 10);

    // If HTML ID is valid, fetch the HTML; otherwise, set fetchedHtml to empty string
    let fetchedHtml = "";
    if (Number.isFinite(htmlId) && htmlId > 0) {
        const { content: result } = await fetchWebResources("ZDATA", "Z_PK", htmlId, "ZILPRESOURCE");
        fetchedHtml = result;
    }

    if (!fetchedHtml) {
        // Profile has no content for this page number (or no resources at all).
        // Return a friendly minimal HTML so the iframe never hard-errors.
        return buildNoBooksHtml();
    }

    // Process HTML to replace image sources with data URLs
    const processedHtml = await replaceImagesInHtml(fetchedHtml);

    // Extract CSS ID from HTML
    const htmlLines = processedHtml.split('\n');
    const linkTagLine = htmlLines[4];  // 5th line (0-based index is 4)
    const hrefMatch = linkTagLine.match(/href=".*\/(\d+)"/);
    const cssId = hrefMatch ? parseInt(hrefMatch[1]) : null;

    // If CSS ID is valid, fetch the CSS; otherwise, set fetchedCss to empty string
    let fetchedCss = "";
    if (cssId !== null) {
        const { content: result } = await fetchWebResources("ZDATA", "Z_PK", cssId, "ZILPRESOURCE");
        fetchedCss = result;
    }

    // Remove everything but the body
    const lines = processedHtml.split('\n');
    const modifiedHtml = lines.slice(6, -1)
        .join('\n')
        .replace(/^<body\b[^>]*>/i, '')  // Remove opening <body> tag
        .replace(/<\/body\s*>$/i, '')   // Remove closing </body> tag
        .trim();                        // Remove any leading/trailing whitespace

    const htmlWithCss = `
    <html>
        <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <style>
                ${fetchedCss}
            </style>
        </head>
        <body>
            ${modifiedHtml}
            <script>
            function scaleContent() {
                const body = document.body;
                const html = document.documentElement;
                
                // Force layout calculation for Firefox
                body.style.transform = '';
                body.offsetHeight; // Trigger reflow
                
                const containerWidth = window.innerWidth;
                const containerHeight = window.innerHeight;
                const contentWidth = Math.max(body.scrollWidth, body.offsetWidth);
                const contentHeight = Math.max(body.scrollHeight, body.offsetHeight);
                
                const scale = Math.min(
                    (containerWidth / contentWidth) * 2,
                    (containerHeight / contentHeight) * 2,
                    1
                );
                
                if (scale < 1) {
                    body.style.cssText = "transform: scale(" + scale + "); transform-origin: 0 0; width: " + contentWidth + "px; height: " + contentHeight + "px;";
                }
            }
            
            window.addEventListener('load', () => setTimeout(scaleContent, 0));
            </script>
        </body>
    </html>
    `;

    return htmlWithCss;
};

const buildIframeSrc = (htmlContent: string) => {
    // Create a Blob from the HTML content
    const blob = new Blob([htmlContent], { type: 'text/html' });

    // Generate a URL for the Blob
    return URL.createObjectURL(blob);
};

function buildNoBooksHtml(): string {
    return `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          body {
            font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
            margin: 0;
            padding: 24px;
            background: white;
            color: #111827;
          }
          .card {
            max-width: 720px;
            margin: 64px auto;
            padding: 20px 18px;
            border: 1px solid rgba(0,0,0,0.1);
            border-radius: 12px;
          }
          h1 { font-size: 18px; margin: 0 0 6px 0; }
          p { margin: 0; color: #4b5563; font-size: 14px; line-height: 1.4; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>There are no books</h1>
          <p>This profile has no downloaded books/resources yet.</p>
        </div>
      </body>
    </html>
  `;
}

// fetch content from DB by ID return json
const fetchWebResources = async (col1: string, col2: string, id: number, table: string) => {
    try {
        const response = await fetch(`/api/getWebResources?col1=${col1}&col2=${col2}&id=${id}&table=${table}`);

        if (!response.ok) {
            throw new Error(`Fetch error! status: ${response.status}`);
        }
        const data = await response.json();
        if (data && data.content) {
            return { content: data.content };
        }
        return { content: '' };
    } catch (error) {
        console.error(`Error fetching web resources for ID ${id}:`, error);
        return { content: '' };
    }
};

// fetch max integer from column 
const fetchMaxIntCol = async (col: string, table: string) => {
    try {
        const response = await fetch(`/api/getMaxIntCol?col=${col}&table=${table}`);

        if (!response.ok) {
            throw new Error(`Fetch error! status: ${response.status}`);
        }
        const data = await response.json();

        if (data && data.content) {
            return { content: data.content };
        }
        return { content: 0 };
    } catch (error) {
        console.error(`Error fetching resource`, error);
        return { content: 0 };
    }
};

// Helper function to replace image sources with data URLs
async function replaceImagesInHtml(html: string): Promise<string> {
    let modifiedHtml = html;
    const imgTags = html.match(/<img.*?src=".*?pk\/(\d+)".*?>/gm) || [];

    for (const imgTag of imgTags) {
        const match = imgTag.match(/src=".*?pk\/(\d+)"/);
        if (match && match[1]) {
            const imgId = match[1];

            try {
                const response = await fetch(`/api/getImage?id=${imgId}`);
                const imageData = await response.json();

                if (imageData && imageData.data) {
                    // Replace the src attribute with the data URL
                    const newImgTag = imgTag.replace(/src=".*?pk\/\d+"/, `src="${imageData.data}"`);
                    modifiedHtml = modifiedHtml.replace(imgTag, newImgTag);
                }
            } catch (error) {
                console.error('Error loading image:', error);
            }
        }
    }

    return modifiedHtml;
}