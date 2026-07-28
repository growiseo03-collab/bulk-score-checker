// pdfReport.js
// Builds the full narrative-style SEO PDF report: cover page, table of
// contents (with real page numbers), an overview page, then a detailed
// Basic SEO / Advanced SEO / Performance / Security breakdown for EVERY
// crawled page - not just the homepage.

const PAGE_W = 210, PAGE_H = 297; // A4 in mm
const MARGIN = 16;
const CONTENT_W = PAGE_W - MARGIN * 2;

const COLOR_GOOD = [30, 122, 60];
const COLOR_WARN = [179, 118, 10];
const COLOR_BAD = [184, 54, 47];
const COLOR_INFO = [60, 90, 200];
const COLOR_INK = [20, 22, 28];
const COLOR_GREY = [110, 110, 100];
const COLOR_BRAND = [140, 230, 40]; // matches the lime-green logo accent

// ---------- Check builders ----------
// Each returns an array of { status: 'good'|'warn'|'bad'|'info', title, box?, explanation }

function checkTitle(page) {
  const items = [];
  const len = page.titleLength || 0;
  if (!page.title) {
    items.push({ status: "bad", title: "The SEO title is missing.",
      explanation: "Every page should have a unique, descriptive <title> tag. Search engines use it as the main headline in search results." });
  } else if (len > 60) {
    items.push({ status: "bad", title: `The SEO title is ${len} characters long, which is too long.`, box: page.title,
      explanation: "Titles over ~60 characters often get truncated in search results. Aim for 30-60 characters that include your target keyword naturally." });
  } else if (len < 30) {
    items.push({ status: "warn", title: `The SEO title is ${len} characters long, which is a bit short.`, box: page.title,
      explanation: "Short titles can be a missed opportunity to include useful descriptive keywords. Aim for 30-60 characters." });
  } else {
    items.push({ status: "good", title: `The SEO title length looks good (${len} characters).`, box: page.title,
      explanation: "Ensure your page's title includes your target keywords, and design it to encourage clicks." });
  }
  if (page.isDupTitle) {
    items.push({ status: "warn", title: "This title is duplicated on another page of the site.",
      explanation: "Duplicate titles make it harder for search engines (and users) to tell pages apart. Give each page a unique title." });
  }
  return items;
}

function checkMetaDescription(page) {
  const len = page.metaDescLength || 0;
  if (!page.metaDesc) {
    return [{ status: "bad", title: "No meta description was found.",
      explanation: "Write a unique meta description for each page. It acts as a mini-advertisement for your content in search results." }];
  }
  if (len > 160) {
    return [{ status: "warn", title: `The meta description is ${len} characters long, which is too long.`, box: page.metaDesc,
      explanation: "Descriptions over ~160 characters get truncated in search results. Aim for 70-160 characters." }];
  }
  if (len < 70) {
    return [{ status: "warn", title: `The meta description is only ${len} characters long, which is too short.`, box: page.metaDesc,
      explanation: "Short descriptions waste an opportunity to summarize the page and encourage clicks. Aim for 70-160 characters." }];
  }
  return [{ status: "good", title: `The meta description is set and is ${len} characters long.`, box: page.metaDesc,
    explanation: "Summarize the page's content in a way that stimulates reader interest, using your target keywords naturally." }];
}

function checkHeadings(page) {
  const items = [];
  if (!page.h1Count) {
    items.push({ status: "bad", title: "No H1 tag was found on the page.",
      explanation: "For best SEO results there should be exactly one H1 tag on each page, summarizing what the page is about." });
  } else if (page.h1Count > 1) {
    items.push({ status: "warn", title: `Multiple H1 tags were found on the page (${page.h1Count}).`,
      explanation: "Most SEO guidance recommends exactly one H1 tag per page to keep a clear content hierarchy." });
  } else {
    items.push({ status: "good", title: "One H1 tag was found on the page.",
      explanation: "Ensure your most important keywords appear in the H1 tag, used naturally for human readers." });
  }
  if (page.h2Count > 0) {
    items.push({ status: "good", title: "H2 tags were found on the page.",
      explanation: "Good use of H2 tags helps break content into logical sections for readers and search engines alike." });
  } else {
    items.push({ status: "info", title: "No H2 tags were found on the page.",
      explanation: "Consider breaking longer content into sections with H2 subheadings, if applicable to this page." });
  }
  return items;
}

function checkImages(page) {
  if (page.imageCount === 0) {
    return [{ status: "info", title: "No images were found on this page.", explanation: "Nothing to check here." }];
  }
  if (page.imagesMissingAlt > 0) {
    return [{ status: "bad", title: `Some images on the page have no alt attribute. (${page.imagesMissingAlt})`,
      explanation: "Make sure every image has a descriptive alt tag - this helps accessibility and gives search engines more context." }];
  }
  return [{ status: "good", title: "All images on the page have alt attributes.",
    explanation: "Nice - keep adding useful, natural alt text (with keywords where relevant) as you add new images." }];
}

function checkLinks(page) {
  const detail = `Internal: ${page.internalLinks ?? 0}\nExternal: ${page.externalLinks ?? 0}`;
  if ((page.internalLinks ?? 0) < 2) {
    return [{ status: "warn", title: "Too few internal links on the page.", box: detail,
      explanation: "Internal links help both readers and search engines navigate your site and understand its structure." }];
  }
  return [{ status: "good", title: "The page has a reasonable number of internal and external links.", box: detail,
    explanation: "Good linking helps distribute authority across your site and gives readers a path to more content." }];
}

function checkCanonical(page) {
  if (!page.canonical) {
    return [{ status: "warn", title: "No canonical tag was found on the page.",
      explanation: "A canonical tag tells search engines which URL is the 'correct' version to index, which helps avoid duplicate-content issues." }];
  }
  return [{ status: "good", title: "The page is using the canonical link tag.", box: page.canonical,
    explanation: "This tells search engines which URL should be treated as authoritative for this content." }];
}

function checkIndexability(page) {
  if (page.indexable === false) {
    return [{ status: "bad", title: "This page is blocked from being indexed.", box: (page.blockReasons || []).join(", "),
      explanation: "Search engines are being told not to index this page. If that's intentional (e.g. an admin page), no action needed - otherwise, remove the blocking rule." }];
  }
  return [{ status: "good", title: "The page does not contain any noindex header or meta tag.",
    explanation: "This page is allowed to be indexed by search engines. (Note: this reflects whether indexing is allowed, not confirmation that Google has actually indexed it - that requires Search Console.)" }];
}

function checkOpenGraph(page) {
  const missing = page.missingOgTags || [];
  if (missing.length === 0) {
    return [{ status: "good", title: "All essential Open Graph meta tags are present.",
      explanation: "Open Graph tags control how this page looks when shared on social media." }];
  }
  return [{ status: "warn", title: "Some Open Graph meta tags are missing.", box: missing.join(", "),
    explanation: "Add the missing Open Graph tags so this page displays correctly with a title, description, and image when shared on social media." }];
}

function checkStructuredData(page) {
  if (page.hasStructuredData) {
    return [{ status: "good", title: "Structured data (Schema.org) was found on the page.",
      explanation: "Structured data helps search engines understand your content and can enable rich results in search listings." }];
  }
  return [{ status: "bad", title: "No Schema.org structured data was found on the page.",
    explanation: "Adding relevant Schema.org markup can make your listing more informative in search results (e.g. star ratings, prices, FAQs)." }];
}

function checkHtmlSize(page) {
  const kb = page.htmlSizeKb ?? 0;
  if (kb > 100) {
    return [{ status: "bad", title: `The size of the HTML document is ${kb} Kb, which is quite large.`,
      explanation: "Large HTML documents take longer to download and parse. Consider trimming unnecessary markup or inline content." }];
  }
  return [{ status: "good", title: `The size of the HTML document is ${kb} Kb.`,
    explanation: "This is a reasonable page size. Removing unnecessary markup and whitespace can help keep it lean as the page grows." }];
}

function checkResponseTime(page) {
  const ms = page.loadTimeMs ?? 0;
  if (ms > 2000) {
    return [{ status: "bad", title: `The response time was ${ms}ms, which is slow.`,
      explanation: "Slow response times hurt both user experience and search rankings. Consider caching, a CDN, or server optimization." }];
  }
  if (ms > 800) {
    return [{ status: "warn", title: `The response time was ${ms}ms.`,
      explanation: "This is acceptable but could be faster. A CDN or caching layer can help." }];
  }
  return [{ status: "good", title: `The response time was under 1 second (${ms}ms).`,
    explanation: "Fast response times improve user experience and are a positive signal for search rankings." }];
}

function checkResourceCount(page) {
  const n = page.estimatedRequestCount ?? 0;
  const note = "(Estimated from tags in the initial HTML only - not a full browser network trace.)";
  if (n > 20) {
    return [{ status: "warn", title: `The page references an estimated ${n} resources. More than 20 can slow page loading.`,
      explanation: `Consider combining or lazy-loading scripts, stylesheets, and images where possible. ${note}` }];
  }
  return [{ status: "good", title: `The page references an estimated ${n} resources.`, explanation: note }];
}

function checkMinification(page) {
  const n = page.unminifiedJsGuess ?? 0;
  const note = "(Based on filenames not containing '.min.js' - a naming heuristic, not a verified check of file contents.)";
  if (n > 0) {
    return [{ status: "warn", title: `Some JavaScript files may not be minified (${n}).`, explanation: `Minifying JS/CSS reduces file size and speeds up page loads. ${note}` }];
  }
  return [{ status: "good", title: "No obviously unminified JavaScript files were detected.", explanation: note }];
}

function checkHttps(page) {
  const isHttps = (page.url || "").startsWith("https://");
  if (isHttps) {
    return [{ status: "good", title: "The page is using a secure transfer protocol (HTTPS).",
      explanation: "HTTPS is a ranking signal and protects your visitors' data in transit." }];
  }
  return [{ status: "bad", title: "The page is not using HTTPS.",
    explanation: "Losing HTTPS means losing visitor trust and search ranking benefit. Install an SSL certificate." }];
}

function notCheckedItem(title) {
  return { status: "info", title, explanation: "Not checked in this free tool - this would require paid API access or server-level access this tool doesn't have." };
}

// ---------- Layout helpers ----------

function scoreFromChecks(checks) {
  if (checks.length === 0) return 100;
  const points = { good: 100, info: 80, warn: 50, bad: 0 };
  const total = checks.reduce((s, c) => s + (points[c.status] ?? 50), 0);
  return Math.round(total / checks.length);
}

function scoreTier(score) {
  if (score >= 70) return { label: "Very Good", color: COLOR_GOOD };
  if (score >= 45) return { label: "Needs Work", color: COLOR_WARN };
  return { label: "Poor", color: COLOR_BAD };
}

function statusColor(status) {
  if (status === "good") return COLOR_GOOD;
  if (status === "warn") return COLOR_WARN;
  if (status === "bad") return COLOR_BAD;
  return COLOR_INFO;
}

function statusSymbol(status) {
  if (status === "good") return "+";
  if (status === "warn") return "!";
  if (status === "bad") return "X";
  return "i";
}

function drawFooter(doc, pageUrl) {
  const h = PAGE_H;
  doc.setFontSize(8);
  doc.setTextColor(...COLOR_GREY);
  doc.text(`Generated for ${pageUrl}`, MARGIN, h - 10);
  doc.text(String(doc.internal.getNumberOfPages()), PAGE_W - MARGIN, h - 10, { align: "right" });
}

function drawScoreCircle(doc, cx, cy, radius, score) {
  const tier = scoreTier(score);
  doc.setFillColor(...tier.color);
  doc.circle(cx, cy, radius, "F");
  doc.setFillColor(255, 255, 255);
  doc.circle(cx, cy, radius * 0.72, "F");
  doc.setTextColor(...tier.color);
  doc.setFontSize(radius * 1.3);
  doc.setFont(undefined, "bold");
  doc.text(String(score), cx, cy + radius * 0.15, { align: "center" });
  doc.setFontSize(radius * 0.4);
  doc.setFont(undefined, "normal");
  doc.text(tier.label, cx, cy + radius * 0.55, { align: "center" });
}

function ensureSpace(doc, y, needed) {
  if (y + needed > PAGE_H - MARGIN - 8) {
    doc.addPage();
    return MARGIN;
  }
  return y;
}

function renderChecklistSection(doc, y, sectionTitle, checks, pageUrlForFooter) {
  y = ensureSpace(doc, y, 16);
  doc.setFontSize(13);
  doc.setTextColor(...COLOR_INK);
  doc.setFont(undefined, "bold");
  doc.text(sectionTitle, MARGIN, y);
  y += 3;
  doc.setDrawColor(220, 220, 214);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  for (const check of checks) {
    const titleLines = doc.splitTextToSize(check.title, CONTENT_W - 10);
    const explLines = check.explanation ? doc.splitTextToSize(check.explanation, CONTENT_W - 10) : [];
    let boxLines = [];
    if (check.box) boxLines = doc.splitTextToSize(String(check.box), CONTENT_W - 16);

    const neededHeight = 6 + titleLines.length * 5 + explLines.length * 4.6 + (boxLines.length ? boxLines.length * 4.6 + 6 : 0) + 6;
    y = ensureSpace(doc, y, neededHeight);
    if (y === MARGIN) { doc.setFontSize(13); } // page just broke, no header repeat needed

    doc.setFillColor(...statusColor(check.status));
    doc.circle(MARGIN + 2.5, y - 1.5, 2.7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(7);
    doc.setFont(undefined, "bold");
    doc.text(statusSymbol(check.status), MARGIN + 2.5, y - 0.6, { align: "center" });

    doc.setTextColor(...COLOR_INK);
    doc.setFontSize(10.5);
    doc.setFont(undefined, "bold");
    doc.text(titleLines, MARGIN + 8, y);
    y += titleLines.length * 5 + 1;

    if (boxLines.length) {
      doc.setFillColor(244, 243, 238);
      doc.rect(MARGIN + 8, y - 3.5, CONTENT_W - 8, boxLines.length * 4.6 + 4, "F");
      doc.setFont("courier", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(60, 60, 55);
      doc.text(boxLines, MARGIN + 11, y + 1);
      y += boxLines.length * 4.6 + 6;
      doc.setFont(undefined, "normal");
    }

    if (explLines.length) {
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 82);
      doc.setFont(undefined, "normal");
      doc.text(explLines, MARGIN + 8, y);
      y += explLines.length * 4.6;
    }
    y += 6;
  }
  return y;
}

// ---------- Main report builder ----------

function generateFullSeoPdf({ startUrl, siteMeta, allPages }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const validPages = allPages.filter(p => p.statusCode && p.statusCode < 400);
  const entriesPerTocPage = 32;
  const tocPagesNeeded = Math.max(1, Math.ceil((validPages.length + 1) / entriesPerTocPage));

  // ---- Cover page ----
  doc.setFillColor(...COLOR_INK);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
  try {
    doc.addImage(BRAND_LOGO_BASE64, "PNG", MARGIN, PAGE_H - 40, 55, 55 * (325 / 600));
  } catch (e) { /* logo optional */ }
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.setFont(undefined, "bold");
  doc.text("Full Website SEO Audit", MARGIN, 60);
  doc.setFontSize(13);
  doc.setFont(undefined, "normal");
  doc.setTextColor(...COLOR_BRAND);
  doc.text(startUrl, MARGIN, 72);
  doc.setTextColor(200, 200, 195);
  doc.setFontSize(10);
  doc.text(`Generated on ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`, MARGIN, 80);
  doc.setFontSize(9);
  doc.text(`${validPages.length} pages analyzed`, MARGIN, 86);

  // ---- Reserve TOC pages ----
  const tocStartPage = doc.internal.getNumberOfPages() + 1;
  for (let i = 0; i < tocPagesNeeded; i++) doc.addPage();

  const tocEntries = []; // { label, pageNumber }

  // ---- Overview page ----
  doc.addPage();
  let overviewY = MARGIN;
  doc.setTextColor(...COLOR_INK);
  doc.setFontSize(18);
  doc.setFont(undefined, "bold");
  doc.text("Overview", MARGIN, overviewY + 6);
  tocEntries.push({ label: "Overview", pageNumber: doc.internal.getNumberOfPages() });

  const homepage = validPages[0] || allPages[0];
  const allChecksFlat = [];
  for (const p of validPages) {
    allChecksFlat.push(
      ...checkTitle(p), ...checkMetaDescription(p), ...checkHeadings(p), ...checkImages(p), ...checkLinks(p),
      ...checkCanonical(p), ...checkIndexability(p), ...checkOpenGraph(p), ...checkStructuredData(p),
      ...checkHtmlSize(p), ...checkResponseTime(p), ...checkResourceCount(p), ...checkMinification(p), ...checkHttps(p)
    );
  }
  const siteScore = scoreFromChecks(allChecksFlat);
  const criticalCount = allChecksFlat.filter(c => c.status === "bad").length;
  const warnCount = allChecksFlat.filter(c => c.status === "warn").length;
  const goodCount = allChecksFlat.filter(c => c.status === "good").length;

  overviewY += 20;
  drawScoreCircle(doc, 45, overviewY + 25, 22, siteScore);
  doc.setFontSize(9.5);
  doc.setTextColor(...COLOR_GREY);
  doc.setFont(undefined, "normal");
  const scoreNote = doc.splitTextToSize("A very good score is between 70 and 100. This is an aggregate across every page crawled, not a single-page score.", 90);
  doc.text(scoreNote, 78, overviewY + 12);

  const statBoxY = overviewY + 50;
  const stats = [
    { label: "Pages Analyzed", value: validPages.length, color: COLOR_INK },
    { label: "Critical Issues", value: criticalCount, color: COLOR_BAD },
    { label: "Warnings", value: warnCount, color: COLOR_WARN },
    { label: "Good Results", value: goodCount, color: COLOR_GOOD },
  ];
  const boxW = (CONTENT_W - 3 * 4) / 4;
  stats.forEach((s, i) => {
    const x = MARGIN + i * (boxW + 4);
    doc.setDrawColor(220, 220, 214);
    doc.rect(x, statBoxY, boxW, 22);
    doc.setTextColor(...s.color);
    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    doc.text(String(s.value), x + boxW / 2, statBoxY + 11, { align: "center" });
    doc.setFontSize(7.5);
    doc.setTextColor(...COLOR_GREY);
    doc.setFont(undefined, "normal");
    doc.text(s.label, x + boxW / 2, statBoxY + 17, { align: "center" });
  });

  let y2 = statBoxY + 34;
  doc.setFontSize(12);
  doc.setTextColor(...COLOR_INK);
  doc.setFont(undefined, "bold");
  doc.text("Search Preview (homepage)", MARGIN, y2);
  y2 += 6;
  doc.setDrawColor(220, 220, 214);
  doc.setFillColor(248, 248, 245);
  doc.rect(MARGIN, y2, CONTENT_W, 26, "FD");
  doc.setFontSize(8.5);
  doc.setTextColor(90, 90, 82);
  doc.setFont(undefined, "normal");
  doc.text(homepage ? homepage.url : startUrl, MARGIN + 4, y2 + 7);
  doc.setFontSize(12);
  doc.setTextColor(26, 13, 171);
  doc.text(doc.splitTextToSize(homepage?.title || "(no title)", CONTENT_W - 8), MARGIN + 4, y2 + 14);
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 74);
  doc.text(doc.splitTextToSize(homepage?.metaDesc || "(no meta description)", CONTENT_W - 8), MARGIN + 4, y2 + 21);

  let y3 = y2 + 34;
  doc.setFontSize(12);
  doc.setTextColor(...COLOR_INK);
  doc.setFont(undefined, "bold");
  doc.text("Site-Wide Technical Summary", MARGIN, y3);
  y3 += 7;
  const techRows = [
    ["SSL certificate valid", siteMeta.sslValid ? "Yes" : "No"],
    ["robots.txt found", siteMeta.robotsFound ? "Yes" : "No"],
    ["sitemap.xml found", siteMeta.sitemapFound ? "Yes" : "No"],
    ["Domain age", siteMeta.domainAgeDays ? `${Math.round(siteMeta.domainAgeDays / 365 * 10) / 10} years` : "Unknown"],
  ];
  doc.setFontSize(9.5);
  doc.setFont(undefined, "normal");
  techRows.forEach(([label, val], i) => {
    const ry = y3 + i * 7;
    doc.setTextColor(...COLOR_GREY);
    doc.text(label, MARGIN, ry);
    doc.setTextColor(...COLOR_INK);
    doc.text(val, PAGE_W - MARGIN, ry, { align: "right" });
    doc.setDrawColor(235, 235, 230);
    doc.line(MARGIN, ry + 2, PAGE_W - MARGIN, ry + 2);
  });

  drawFooter(doc, startUrl);

  // ---- Per-page detailed sections ----
  for (const page of validPages) {
    doc.addPage();
    tocEntries.push({ label: page.url, pageNumber: doc.internal.getNumberOfPages() });

    let y = MARGIN;
    const pageChecks = {
      basic: [...checkTitle(page), ...checkMetaDescription(page), ...checkHeadings(page), ...checkImages(page), ...checkLinks(page)],
      advanced: [...checkCanonical(page), ...checkIndexability(page), ...checkOpenGraph(page), ...checkStructuredData(page)],
      performance: [...checkHtmlSize(page), ...checkResponseTime(page), ...checkResourceCount(page), ...checkMinification(page)],
      security: [...checkHttps(page), notCheckedItem("Directory listing check"), notCheckedItem("Google Safe Browsing malware check")],
    };
    const pageScore = scoreFromChecks([...pageChecks.basic, ...pageChecks.advanced, ...pageChecks.performance, ...pageChecks.security]);

    drawScoreCircle(doc, MARGIN + 12, y + 14, 12, pageScore);
    doc.setFontSize(9);
    doc.setTextColor(...COLOR_GREY);
    doc.setFont(undefined, "normal");
    doc.text("Page Score", MARGIN + 30, y + 8);
    doc.setFontSize(11);
    doc.setTextColor(...COLOR_INK);
    doc.setFont(undefined, "bold");
    doc.text(doc.splitTextToSize(page.url, CONTENT_W - 32), MARGIN + 30, y + 15);
    y += 32;

    y = renderChecklistSection(doc, y, "Basic SEO", pageChecks.basic, startUrl);
    y = renderChecklistSection(doc, y, "Advanced SEO", pageChecks.advanced, startUrl);
    y = renderChecklistSection(doc, y, "Performance", pageChecks.performance, startUrl);
    y = renderChecklistSection(doc, y, "Security", pageChecks.security, startUrl);

    drawFooter(doc, startUrl);
  }

  // ---- Go back and fill in the TOC pages now that we know real page numbers ----
  let entryIndex = 0;
  for (let p = 0; p < tocPagesNeeded; p++) {
    doc.setPage(tocStartPage + p);
    let ty = MARGIN;
    if (p === 0) {
      doc.setFontSize(20);
      doc.setTextColor(...COLOR_INK);
      doc.setFont(undefined, "bold");
      doc.text("Table of Contents", MARGIN, ty + 4);
      ty += 18;
    } else {
      ty += 6;
    }
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    const endIndex = Math.min(entryIndex + entriesPerTocPage, tocEntries.length);
    for (; entryIndex < endIndex; entryIndex++) {
      const entry = tocEntries[entryIndex];
      const label = entry.label.length > 78 ? entry.label.slice(0, 75) + "..." : entry.label;
      doc.setTextColor(...COLOR_INK);
      doc.text(label, MARGIN, ty);
      doc.setTextColor(...COLOR_GREY);
      doc.text(String(entry.pageNumber), PAGE_W - MARGIN, ty, { align: "right" });
      doc.setDrawColor(230, 230, 224);
      doc.line(MARGIN, ty + 2, PAGE_W - MARGIN, ty + 2);
      ty += 8;
    }
  }

  doc.save(`seo-audit-${(startUrl || "site").replace(/[^a-z0-9]/gi, "-")}-${Date.now()}.pdf`);
}
