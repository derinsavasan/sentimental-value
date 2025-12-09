// Config
const CONFIG = {
  VALUE_MODE: "hours",
  SPLIT_MULTI_GENRES: true,
  valueFields: {
    hours: ["Watch Time", "watch_time", "WatchTime", "Hours Viewed", "hours_viewed", "HoursViewed"],
    views: ["View Count", "view_count", "ViewCount", "Views", "views"]
  },
  languageFields: ["language", "Language", "originalLanguage", "TMDBLanguage"],
  genreFields: ["genres", "Genres", "TMDBGenres"],
  genreMap: {
    "sci-fi": "sci-fi", "sci fi": "sci-fi", "scifi": "sci-fi",
    "science": "sci-fi", "fiction": "sci-fi", "science fiction": "sci-fi",
    "science-fiction": "sci-fi"
  },
  languageInfers: {
    spanish: "Spanish", french: "French", german: "German", korean: "Korean",
    japanese: "Japanese", chinese: "Chinese", italian: "Italian", portuguese: "Portuguese",
    hindi: "Hindi", russian: "Russian", arabic: "Arabic"
  },
  files: [
    { path: "data/NetflixMovies_enriched.csv", type: "Movie" },
    { path: "data/NetflixTV_enriched.csv", type: "TV" }
  ],
  // Genre valence weights (warm = 1, cold = 0, neutral = 0.5)
  // Based on TMDB-style theme classification
  genreValenceWeights: {
    // Warm genres (high engagement, emotional connection)
    "romance": 0.95,
    "comedy": 0.85,
    "family": 0.9,
    "children": 0.85,
    "animation": 0.75,
    "musical": 0.8,
    "music": 0.75,
    // Neutral-warm genres
    "drama": 0.65,
    "adventure": 0.6,
    "fantasy": 0.55,
    "sports": 0.6,
    // Neutral genres
    "action": 0.5,
    "sci-fi": 0.45,
    "mystery": 0.45,
    "biography": 0.5,
    "history": 0.45,
    // Cold genres (detached, cerebral viewing)
    "thriller": 0.35,
    "crime": 0.3,
    "horror": 0.25,
    "war": 0.2,
    "documentary": 0.4,
    "western": 0.35
  }
};

// Constants
const CHART_SIZE_RATIO = 0.9; // Chart takes up 90% of viewport
const LINE_SPACING = '1.2em'; // Spacing between lines in center label
const RESIZE_DEBOUNCE_MS = 250; // Delay before re-rendering on window resize
const MIN_ARC_WIDTH = 2; // Minimum width of sunburst arcs
const MIN_PAD_ANGLE = 0.0005; // Keep pads tiny so hairline slices stay visible
const SLICE_TITLES_COUNT = 3;

// Global State
let VALUE_MODE = CONFIG.VALUE_MODE;
let SPLIT_MULTI_GENRES = CONFIG.SPLIT_MULTI_GENRES;
let typeScale, genreScale, languageScale;
let keywordData = null; // Store keyword analysis results
let matrixData = null; // Store processed matrix data
let allRawRows = null; // Store raw rows for matrix calculations
let matrixTypeFilter = 'all'; // all | Movie | TV
let sliceTitleMap = null; // Map for sunburst hover titles/posters

// Utility Functions
const cleanGenre = g => g.replace(/[().,;!?']/g, '').trim();
const toNumber = x => {
  if (!x || x === "") return NaN;
  const s = String(x).replace(/,/g, "").trim();
  return +s.match(/^([0-9.]+)$/)?.[1] || +s;
};
const parseRuntimeMinutes = val => {
  if (val === undefined || val === null) return null;
  const str = String(val).trim();
  if (str.includes(':')) {
    const parts = str.split(':').map(p => parseInt(p, 10));
    if (parts.every(n => !isNaN(n))) {
      const [h = 0, m = 0, s = 0] = parts;
      const total = h * 60 + m + Math.floor(s / 60);
      return isFinite(total) && total > 0 ? total : null;
    }
  }
  const cleaned = str.replace(/[^0-9.]/g, '');
  const num = toNumber(cleaned);
  return isFinite(num) && num > 0 ? Math.round(num) : null;
};
const countryNames = {
  us: "United States",
  gb: "United Kingdom",
  uk: "United Kingdom",
  ca: "Canada",
  fr: "France",
  de: "Germany",
  jp: "Japan",
  kr: "South Korea",
  cn: "China",
  it: "Italy",
  es: "Spain",
  br: "Brazil",
  in: "India",
  mx: "Mexico",
  ar: "Argentina",
  au: "Australia",
  nz: "New Zealand",
  ru: "Russia",
  se: "Sweden",
  no: "Norway",
  dk: "Denmark",
  fi: "Finland",
  nl: "Netherlands",
  be: "Belgium",
  tr: "Turkey",
  ie: "Ireland",
  ch: "Switzerland",
  at: "Austria",
  pl: "Poland",
  cz: "Czechia",
  hu: "Hungary",
  gr: "Greece",
  pt: "Portugal",
  co: "Colombia",
  cl: "Chile",
  pe: "Peru",
  za: "South Africa",
  eg: "Egypt",
  ae: "United Arab Emirates",
  sa: "Saudi Arabia",
  il: "Israel",
  id: "Indonesia",
  th: "Thailand",
  vn: "Vietnam",
  ph: "Philippines",
  my: "Malaysia",
  sg: "Singapore",
  tw: "Taiwan",
  hk: "Hong Kong"
};
const normalizeCountryName = c => {
  if (!c) return '';
  const parts = String(c).split(/[,/|;]+/).map(p => p.trim()).filter(Boolean);
  const mapped = parts.map(p => {
    if (p.length === 2) {
      const name = countryNames[p.toLowerCase()];
      return name || p;
    }
    return p;
  });
  return mapped.join(', ');
};
const countryHeuristic = lang => {
  if (!lang) return '';
  const key = lang.trim().toLowerCase();
  // map both codes and names
  const map = {
    en: 'United States',
    english: 'United States',
    es: 'Spain',
    spanish: 'Spain',
    pt: 'Portugal',
    portuguese: 'Portugal',
    fr: 'France',
    french: 'France',
    de: 'Germany',
    german: 'Germany',
    it: 'Italy',
    italian: 'Italy',
    ja: 'Japan',
    japanese: 'Japan',
    ko: 'South Korea',
    korean: 'South Korea',
    hi: 'India',
    hindi: 'India',
    zh: 'China',
    chinese: 'China',
    ru: 'Russia',
    russian: 'Russia',
    sv: 'Sweden',
    swedish: 'Sweden',
    da: 'Denmark',
    danish: 'Denmark',
    fi: 'Finland',
    finnish: 'Finland',
    no: 'Norway',
    norwegian: 'Norway',
    nl: 'Netherlands',
    dutch: 'Netherlands',
    tr: 'Turkey',
    turkish: 'Turkey',
    ar: 'United Arab Emirates',
    arabic: 'United Arab Emirates',
    th: 'Thailand',
    thai: 'Thailand',
    id: 'Indonesia',
    indonesian: 'Indonesia',
    pl: 'Poland',
    polish: 'Poland'
  };
  return map[key] || '';
};
const normalizePoster = url => {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed || trimmed.toLowerCase() === 'n/a') return '';
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
};
const sanitizeTitle = t => {
  if (!t) return '';
  let s = String(t);
  s = s.replace(/\/\/.*$/,'');       // drop anything after //
  s = s.replace(/[_]+/g, ' ');       // underscores to space
  s = s.replace(/:+\s*$/,'');        // trailing colons
  s = s.replace(/\s+/g, ' ').trim(); // collapse whitespace
  return s;
};
const formatValue = v => {
  if (!isFinite(v) || v <= 0) return "0";
  let divisor, suffix;
  if (v >= 1e9) { divisor = 1e9; suffix = "B"; }
  else if (v >= 1e6) { divisor = 1e6; suffix = "M"; }
  else if (v >= 1e3) { divisor = 1e3; suffix = "K"; }
  else return String(Math.round(v));
  let str = (v / divisor).toFixed(2);
  str = str.replace(/(\.\d*?)0+$/, '$1');
  return str + suffix;
};
const pluralize = word => {
  if (!word) return '';
  if (word.toLowerCase() === 'comedy') return 'comedies';
  if (word.toLowerCase() === 'tv') return 'TV shows';
  if (word.toLowerCase() === 'sci-fi') return 'sci-fi';
  if (word.toLowerCase() === 'espionage') return 'espionage';
  if (word.toLowerCase() === 'children') return 'children';
  if (word.endsWith('y') && !/[aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
  if (word.endsWith('s')) return word + 'es';
  return word + 's';
};
const formatType = word => word.toLowerCase() === 'tv' ? 'TV' : word.toLowerCase();

// Data Processing
function normalizeRow(row, type) {
  let lang = row.originalLanguage?.trim() ||
             row.language?.trim() ||
             row.Language?.trim();
  if (!lang && row.title) {
    const title = row.title.toLowerCase();
    for (const [key, val] of Object.entries(CONFIG.languageInfers)) {
      if (title.includes(key) || new RegExp(val.toLowerCase(), 'i').test(title)) {
        lang = val; break;
      }
    }
    if (!lang && /[^\x00-\x7F]/.test(row.title)) lang = "Non-English";
  }
  lang ||= "English";

  let rawGenres = row.TMDBGenres?.trim() || row.genres?.trim() || row.Genres?.trim() || "Unspecified";
  const genres = String(rawGenres).split(/\s*[,|\/;]\s*/).map(s => s.trim()).filter(Boolean).map(g => {
    const cleaned = cleanGenre(g);
    return CONFIG.genreMap[cleaned.toLowerCase()] || cleaned;
  });
  const primaryGenre = genres[0] || "Unspecified";

  let vField = CONFIG.valueFields[VALUE_MODE].find(k => row[k] !== undefined);
  let num = toNumber(vField ? row[vField] : undefined);
  num = isFinite(num) && num >= 0 ? num : 0;

  const releaseYear = (row.ReleaseYear || row['Release Date'] || row.startYear || row.premiered || '').toString().slice(0, 4) || '';
  const runtime =
    parseRuntimeMinutes(row.Runtime) ??
    parseRuntimeMinutes(row.runtimeMinutes) ??
    parseRuntimeMinutes(row.averageRuntime) ??
    parseRuntimeMinutes(row.runtime) ??
    '';

  let country = normalizeCountryName(row.country || row.Country || row.dvdCountry || row['network.country'] || row.TMDBCountry || '');
  if (!country) {
    const langFallback = row.originalLanguage || row.language || row.Language || '';
    country = countryHeuristic(langFallback);
  }

  const poster = normalizePoster(row.TMDBPoster || row.poster || '');
  const titleNorm = sanitizeTitle(row.TitleCanonical || row.Title || row.primaryTitle || row.originalTitle || row.name || '');

  return {
    Type: type,
    Language: lang,
    Genres: genres,
    PrimaryGenre: primaryGenre,
    Value: num,
    ReleaseYear: releaseYear,
    Runtime: runtime,
    Title: titleNorm,
    Country: country,
    TMDBPoster: poster
  };
}

function aggregateLeafTuples(rows) {
  const map = new Map();
  rows.forEach(r => {
    const key = `${r.Type}|${r.PrimaryGenre}|${r.Language}`;
    map.set(key, (map.get(key) || 0) + r.Value);
  });
  for (const [key, sum] of map.entries()) if (sum <= 0) map.delete(key);
  return map;
}

function tuplesToSequences(map) {
  return Array.from(map.entries()).map(([key, sum]) => {
    const [Type, Genre, Language] = key.split("|");
    return [`${Type}|${Genre}|${Language}|end`, sum];
  });
}

function buildHierarchy(csvRows) {
  const root = { name: "root", children: [] };
  csvRows.forEach(([seq, size]) => {
    const parts = seq.split("|");
    let node = root;
    for (let i = 0; i < parts.length; ++i) {
      const name = parts[i];
      if (name === "end") {
        node.value = (node.value || 0) + size;
        break;
      }
      let child = node.children.find(c => c.name === name);
      if (!child) {
        child = { name, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  });
  pruneEmptyBranches(root);
  return root;
}

function pruneEmptyBranches(node) {
  if (node.children) {
    node.children = node.children.filter(child => {
      pruneEmptyBranches(child);
      return (child.children?.length > 0) || (child.value > 0);
    });
  }
}

// Keyword Analysis
function analyzeTitleKeywords(rows) {
  const keywordsByTypeGenreLang = new Map(); // "Type|Genre|Language" → Map(word → {count, hours})
  const stopWords = ['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'with', 'from', 'by', 'this', 'that', 'will', 'who', 'what', 'when', 'where', 'how', 'their', 'into', 'out', 'about', 'after', 'his', 'her', 'she', 'they', 'them', 'series', 'movie', 'season', 'limited', 'some', 'life', 'world', 'every', 'story', 'while', 'being', 'more'];
  const languageWords = ['english','spanish','french','german','korean','japanese','chinese','italian','portuguese','hindi','russian','arabic'];
  const singleWordTitles = new Set();

  const tokenize = (text) => text
    .toLowerCase()
    .split(/[\s\-:.,;!?'"()\[\]]+/)
    .map(w => w.replace(/[^\w]/g, ''))
    .filter(w => w.length > 3 && /^[a-z]+$/.test(w));

  // Track single-word titles to avoid echoing exact single-token names
  rows.forEach(row => {
    const tokens = tokenize(row.Title || '');
    if (tokens.length === 1) singleWordTitles.add(tokens[0]);
  });

  rows.forEach(row => {
    // Create keys for both Type|Genre and Type|Genre|Language levels
    const genreKey = `${row.Type}|${row.PrimaryGenre}`;
    const langKey = row.Language ? `${row.Type}|${row.PrimaryGenre}|${row.Language}` : null;
    
    // Use summary (TV) and titles (all) for keywords
    let textParts = [];
    if (row.Type === 'TV' && row.Summary) {
      textParts.push(row.Summary.replace(/<[^>]*>/g, ' '));
    }
    if (row.Title) {
      textParts.push(row.Title);
    }
    const text = textParts.join(' ').toLowerCase();
    if (!text) return;
    
    // Build exclusion set: stop words + language words
    const exclude = new Set(stopWords);
    languageWords.forEach(w => exclude.add(w));
    const titleTokens = tokenize(row.Title || '');
    const isSingleWordTitle = titleTokens.length === 1 ? titleTokens[0] : null;
    
    // Split and filter words (exclude stop words and title words)
    const words = tokenize(text).filter(w => {
      if (exclude.has(w)) return false;
      // Drop exact single-word title echoes
      if (isSingleWordTitle && w === isSingleWordTitle) return false;
      return true;
    });
    
    // Store keywords at both genre and language levels
    [genreKey, langKey].forEach(key => {
      if (!key) return;
      
      if (!keywordsByTypeGenreLang.has(key)) {
        keywordsByTypeGenreLang.set(key, new Map());
      }
      
      const keywords = keywordsByTypeGenreLang.get(key);
      words.forEach(word => {
        const data = keywords.get(word) || { count: 0, totalHours: 0 };
        data.count++;
        data.totalHours += row.Value;
        keywords.set(word, data);
      });
    });
  });
  
  return keywordsByTypeGenreLang;
}

function getTopKeywords(node, keywordData, limit = 3) {
  if (!keywordData || (node.depth !== 2 && node.depth !== 3)) return null;
  
  // Extract type, genre, and language based on depth
  const type = node.depth === 2 ? node.parent.data.name : node.parent.parent.data.name;
  const genre = node.depth === 2 ? node.data.name : node.parent.data.name;
  const language = node.depth === 3 ? node.data.name : null;
  
  // Try language-specific key first (for depth 3), then fall back to genre key
  const langKey = language ? `${type}|${genre}|${language}` : null;
  const genreKey = `${type}|${genre}`;
  
  // Use language-specific keywords if available, otherwise use genre-level
  const key = (langKey && keywordData.has(langKey)) ? langKey : genreKey;
  
  if (!keywordData.has(key)) return null;
  
  // Filter out the genre name itself from keywords
  const genreLower = genre.toLowerCase();
  
  return Array.from(keywordData.get(key).entries())
    .map(([word, data]) => ({ word, ...data }))
    .filter(k => k.word !== genreLower) // Exclude genre name
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, limit)
    .map(k => k.word);
}

// ==========================================
// SENTIMENT MATRIX CALCULATIONS
// ==========================================

/**
 * Simple k-means clustering implementation
 */
function kMeans(points, k, maxIterations = 50) {
  // Initialize centroids randomly from existing points
  const centroids = [];
  const usedIndices = new Set();
  while (centroids.length < k) {
    const idx = Math.floor(Math.random() * points.length);
    if (!usedIndices.has(idx)) {
      usedIndices.add(idx);
      centroids.push({ x: points[idx].x, y: points[idx].y });
    }
  }
  
  let assignments = new Array(points.length).fill(0);
  
  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to nearest centroid
    const newAssignments = points.map(p => {
      let minDist = Infinity;
      let closest = 0;
      centroids.forEach((c, i) => {
        const dist = Math.sqrt((p.x - c.x) ** 2 + (p.y - c.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      });
      return closest;
    });
    
    // Check for convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    
    if (!changed) break;
    
    // Update centroids
    for (let i = 0; i < k; i++) {
      const clusterPoints = points.filter((_, idx) => assignments[idx] === i);
      if (clusterPoints.length > 0) {
        centroids[i] = {
          x: d3.mean(clusterPoints, p => p.x),
          y: d3.mean(clusterPoints, p => p.y)
        };
      }
    }
  }
  
  return { assignments, centroids };
}

/**
 * Calculate matrix data for sentiment visualization using cluster analysis
 * X-axis: Derived from hours per view (engagement depth)
 * Y-axis: Derived from total hours (popularity/reach)
 * Clusters emerge naturally from the data
 */
function calculateMatrixData(rawRows) {
  // Step 1: Get both hours and views for each row, and dedupe by title+year+type
  const dedupeMap = new Map();
  rawRows.forEach(row => {
    let hoursField = CONFIG.valueFields.hours.find(k => row[k] !== undefined);
    let hours = toNumber(hoursField ? row[hoursField] : undefined);
    hours = isFinite(hours) && hours >= 0 ? hours : 0;
    
    let viewsField = CONFIG.valueFields.views.find(k => row[k] !== undefined);
    let views = toNumber(viewsField ? row[viewsField] : undefined);
    views = isFinite(views) && views >= 0 ? views : 0;
    
    const normTitle = sanitizeTitle(row.TitleCanonical || row.Title || row.primaryTitle || row.originalTitle || row.name || 'Unknown');
    const country = normalizeCountryName(row.Country || row.country || row.dvdCountry || row.TMDBCountry || '');
    const genreCap = row.PrimaryGenre ? row.PrimaryGenre.charAt(0).toUpperCase() + row.PrimaryGenre.slice(1) : row.PrimaryGenre;
    const runtimeNorm =
      parseRuntimeMinutes(row.Runtime) ??
      parseRuntimeMinutes(row.runtimeMinutes) ??
      parseRuntimeMinutes(row.averageRuntime) ??
      parseRuntimeMinutes(row.runtime) ??
      null;

    const key = `${row.Type}|${normTitle}|${row.ReleaseYear || ''}`;
    const existing = dedupeMap.get(key);
    const merged = existing ? {
      ...existing,
      hours: existing.hours + hours,
      views: existing.views + views
    } : {
      ...row,
      hours,
      views,
      title: normTitle,
      type: row.Type,
      genre: genreCap,
      language: row.Language,
      country,
      runtime: runtimeNorm
    };
    dedupeMap.set(key, merged);
  });

  const rowsWithBothMetrics = Array.from(dedupeMap.values()).filter(r => r.hours > 0 && r.views > 0);
  
  if (rowsWithBothMetrics.length === 0) return null;
  
  // Step 2: Calculate key metrics
  rowsWithBothMetrics.forEach(row => {
    row.hoursPerView = row.hours / row.views; // Engagement depth (how long people stay)
  });
  
  // Step 3: Use percentile ranks for both axes (spreads data evenly)
  // X-axis: Hours per view rank (low = casual clicks, high = deep engagement)
  const sortedByHPV = [...rowsWithBothMetrics].sort((a, b) => a.hoursPerView - b.hoursPerView);
  sortedByHPV.forEach((row, idx) => {
    row.xRank = idx / (sortedByHPV.length - 1 || 1);
  });
  
  // Y-axis: Total hours rank (low = niche, high = mainstream)
  const sortedByHours = [...rowsWithBothMetrics].sort((a, b) => a.hours - b.hours);
  sortedByHours.forEach((row, idx) => {
    row.yRank = idx / (sortedByHours.length - 1 || 1);
  });
  
  // Step 4: Create initial points for clustering
  const pointsForClustering = rowsWithBothMetrics.map(row => ({
    x: row.xRank,
    y: row.yRank,
    row
  }));
  
  // Step 5: Run k-means with 4 clusters
  const { assignments, centroids } = kMeans(pointsForClustering, 4);
  
  // Step 6: Label clusters based on centroid positions
  // Sort centroids to assign meaningful labels
  const labeledCentroids = centroids.map((c, i) => ({
    ...c,
    index: i,
    quadrant: (c.x >= 0.5 ? 'warm' : 'cold') + '-' + (c.y >= 0.5 ? 'charged' : 'flat')
  }));
  
  // Step 7: Create final matrix points with cluster info
  const clusterColors = ['#E50914', '#831010', '#ff6b6b', '#c92a2a'];
  const matrixPoints = rowsWithBothMetrics.map((row, idx) => {
    const cluster = assignments[idx];
    const jitterX = (Math.random() - 0.5) * 0.03;
    const jitterY = (Math.random() - 0.5) * 0.03;
    
    return {
      title: row.title,
      releaseYear: row.ReleaseYear || '',
      runtime: row.Runtime || '',
      type: row.type,
      genre: row.genre,
      language: row.language,
      country: row.country || '',
      hours: row.hours,
      views: row.views,
      hoursPerView: row.hoursPerView,
      poster: row.TMDBPoster || row.poster || '',
      randomKey: Math.random(),
      x: Math.max(0.01, Math.min(0.99, row.xRank + jitterX)),
      y: Math.max(0.01, Math.min(0.99, row.yRank + jitterY)),
      cluster,
      clusterColor: clusterColors[cluster % clusterColors.length],
      size: Math.sqrt(row.hours)
    };
  });
  
  // Step 8: Calculate cluster stats
  const clusterStats = labeledCentroids.map((centroid, i) => {
    const clusterPoints = matrixPoints.filter(p => p.cluster === i);
    const genres = d3.rollup(clusterPoints, v => v.length, d => d.genre);
    const topGenres = Array.from(genres.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g]) => g);
    
    return {
      ...centroid,
      count: clusterPoints.length,
      totalHours: d3.sum(clusterPoints, p => p.hours),
      topGenres,
      avgHoursPerView: d3.mean(clusterPoints, p => p.hoursPerView)
    };
  });
  
  return {
    points: matrixPoints,
    clusters: clusterStats,
    stats: {
      totalPoints: matrixPoints.length
    }
  };
}

// ==========================================
// MATRIX RENDERING
// ==========================================

function renderMatrix(data) {
  const container = d3.select("#chart");
  container.selectAll("*").remove();
  const footerEl = document.getElementById('matrixFooter');
  const filteredTotalEl = document.getElementById('filteredTotal');
  if (filteredTotalEl) filteredTotalEl.style.display = 'none';
  if (footerEl) footerEl.style.display = 'block';
  
  if (!data || !data.points || data.points.length === 0) {
    container.append("div")
      .style("text-align", "center")
      .style("padding-top", "40vh")
      .style("color", "#666")
      .text("No data available for matrix view");
    return;
  }
  
  // Dimensions - use full viewport, minimal margin for true fill
  const margin = { top: 0, right: 0, bottom: 0, left: 0 };
  const containerWidth = window.innerWidth;
  const containerHeight = window.innerHeight;
  const width = containerWidth - margin.left - margin.right;
  const height = containerHeight - margin.top - margin.bottom;

  // Apply type filter
  const filteredPoints = data.points.filter(p => {
    if (matrixTypeFilter === 'all') return true;
    return p.type.toLowerCase() === matrixTypeFilter.toLowerCase();
  });
  const basePoints = filteredPoints.length > 0 ? filteredPoints : data.points;

  // Recompute normalized ranks within the current filter to keep distribution centered
  const pointsForView = (() => {
    const copy = basePoints.map(p => ({ ...p }));
    const sortedX = [...copy].sort((a, b) => a.hoursPerView - b.hoursPerView);
    sortedX.forEach((p, idx) => p.xNorm = idx / (sortedX.length - 1 || 1));
    const sortedY = [...copy].sort((a, b) => a.hours - b.hours);
    sortedY.forEach((p, idx) => p.yNorm = idx / (sortedY.length - 1 || 1));
    return copy.map(p => ({
      ...p,
      x: p.xNorm,
      y: p.yNorm
    }));
  })();
  
  const svgRoot = container.append("svg")
    .attr("width", containerWidth)
    .attr("height", containerHeight)
    .style("display", "block");
  
  // Soft edge vignette to smooth boundary
  const defsRoot = svgRoot.append("defs");
  const vignette = defsRoot.append("radialGradient")
    .attr("id", "matrix-vignette")
    .attr("cx", "50%").attr("cy", "50%").attr("r", "80%");
  vignette.append("stop").attr("offset", "0%").attr("stop-color", "#f8f8f8").attr("stop-opacity", 0);
  vignette.append("stop").attr("offset", "60%").attr("stop-color", "#f8f8f8").attr("stop-opacity", 0);
  vignette.append("stop").attr("offset", "100%").attr("stop-color", "#f8f8f8").attr("stop-opacity", 0.12);

  // Base and overlay for smoother edge fade
  svgRoot.append("rect")
    .attr("x", 0).attr("y", 0)
    .attr("width", containerWidth).attr("height", containerHeight)
    .attr("fill", "#f8f8f8");
  svgRoot.append("rect")
    .attr("x", 0).attr("y", 0)
    .attr("width", containerWidth).attr("height", containerHeight)
    .attr("fill", "url(#matrix-vignette)");

  const svg = svgRoot.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);
  
  // Scales with a larger inset so points stay well clear of edges
  const inset = 76;
  const xScale = d3.scaleLinear().domain([0, 1]).range([inset, width - inset]);
  const yScale = d3.scaleLinear().domain([0, 1]).range([height - inset, inset]);
  
  // Quadrant definitions with NYMag-style labels
  const quadrants = [
    { 
      x: 0, y: 0.5, w: 0.5, h: 0.5, 
      title: "Prestige Pick", 
      subtitle: "Heavy, award-worthy, you'll need a moment after.",
      color: "#f8f8f8"
    },
    { 
      x: 0.5, y: 0.5, w: 0.5, h: 0.5, 
      title: "Crowd Pleaser", 
      subtitle: "Emotional, bingeable, everyone's talking about it.",
      color: "#f8f8f8"
    },
    { 
      x: 0, y: 0, w: 0.5, h: 0.5, 
      title: "Background Noise", 
      subtitle: "On while you scroll. No one remembers the plot.",
      color: "#f8f8f8"
    },
    { 
      x: 0.5, y: 0, w: 0.5, h: 0.5, 
      title: "Comfort Rewatch", 
      subtitle: "Warm, familiar, zero emotional risk.",
      color: "#f8f8f8"
    }
  ];
  
  // Draw quadrant backgrounds
  quadrants.forEach(q => {
    svg.append("rect")
      .attr("x", xScale(q.x))
      .attr("y", yScale(q.y + q.h))
      .attr("width", xScale(q.w) - xScale(0))
      .attr("height", yScale(0) - yScale(q.h))
      .attr("fill", q.color);
  });
  
  // Draw center divider lines (dashed)
  svg.append("line")
    .attr("x1", xScale(0.5)).attr("x2", xScale(0.5))
    .attr("y1", yScale(1)).attr("y2", yScale(0))
    .attr("stroke", "#b01217")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "6,4");
  
  svg.append("line")
    .attr("x1", xScale(0)).attr("x2", xScale(1))
    .attr("y1", yScale(0.5)).attr("y2", yScale(0.5))
    .attr("stroke", "#b01217")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "6,4");

  // Edge tick labels for axes
  svg.append("text")
    .attr("x", xScale(0) - 40)
    .attr("y", yScale(0.5) + 20)
    .attr("text-anchor", "start")
    .attr("font-size", "16px")
    .attr("font-weight", "700")
    .attr("fill", "#555")
    .text("Cold");
  svg.append("text")
    .attr("x", xScale(1) + 40)
    .attr("y", yScale(0.5) + 20)
    .attr("text-anchor", "end")
    .attr("font-size", "16px")
    .attr("font-weight", "700")
    .attr("fill", "#555")
    .text("Warm");
  svg.append("text")
    .attr("x", xScale(0.5))
    .attr("y", yScale(1) - 40)
    .attr("text-anchor", "middle")
    .attr("font-size", "16px")
    .attr("font-weight", "700")
    .attr("fill", "#555")
    .text("Charged");
  svg.append("text")
    .attr("x", xScale(0.5))
    .attr("y", yScale(0) + 40)
    .attr("text-anchor", "middle")
    .attr("font-size", "16px")
    .attr("font-weight", "700")
    .attr("fill", "#555")
    .text("Flat");
  
  // Draw big quadrant titles (NYMag style)
  const quadrantLabels = [
    { title: "Prestige Pick", subtitle: "Heavy, award-worthy, you'll need a moment after.", x: width * 0.25, y: height * 0.25 },
    { title: "Crowd Pleaser", subtitle: "Emotional, bingeable, everyone's talking about it.", x: width * 0.75, y: height * 0.25 },
    { title: "Background Noise", subtitle: "On while you scroll. No one remembers the plot.", x: width * 0.25, y: height * 0.75 },
    { title: "Comfort Rewatch", subtitle: "Warm, familiar, zero emotional risk.", x: width * 0.75, y: height * 0.75 }
  ];
  
  // Density layer responsive to filtered selection
  const densityContours = d3.contourDensity()
    .x(d => xScale(d.x))
    .y(d => yScale(d.y))
    .size([width, height])
    .bandwidth(32)
    (pointsForView);

  const maxDensity = d3.max(densityContours, d => d.value) || 1;
  const densityColor = d3.scaleSequential([0, maxDensity], d3.interpolateReds);

  svg.append("g")
    .attr("fill-opacity", 0.12)
    .selectAll("path")
    .data(densityContours)
    .join("path")
    .attr("d", d3.geoPath())
    .attr("fill", d => densityColor(d.value))
    .attr("stroke", "none");

  // Glow filter for label backplates so they sit above dots/density
  const defs = svg.append("defs");
  const labelGlow = defs.append("filter").attr("id", "label-glow");
  labelGlow.append("feGaussianBlur")
    .attr("stdDeviation", 10)
    .attr("result", "blur");
  labelGlow.append("feColorMatrix")
    .attr("in", "blur")
    .attr("type", "matrix")
    .attr("values", "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.4 0")
    .attr("result", "soft");
  labelGlow.append("feMerge")
    .selectAll("feMergeNode")
    .data(["soft"])
    .join("feMergeNode")
    .attr("in", d => d);

  // Sample points to avoid clutter while keeping read on the space
  const MAX_POINTS = 450;
  const sortedForSample = [...pointsForView].sort((a, b) => a.randomKey - b.randomKey);
  const sampledPoints = sortedForSample.slice(0, Math.min(MAX_POINTS, sortedForSample.length));

  if (footerEl) {
    footerEl.textContent = `Showing ${sampledPoints.length}/${pointsForView.length} titles; density shows full set`;
  }

  // Size scale for points (smaller to not overwhelm the labels)
  const maxSize = d3.max(data.points, d => d.size);
  const sizeScale = d3.scaleSqrt().domain([0, maxSize]).range([2, 10]);
  
  // Tooltip
  const tooltip = d3.select("#tooltip");

  // Draw data points with some jitter to reduce overlap
  svg.selectAll(".matrix-point")
    .data(sampledPoints)
    .join("circle")
    .attr("class", "matrix-point")
    .attr("cx", d => xScale(d.x) + (Math.random() - 0.5) * 3)
    .attr("cy", d => yScale(d.y) + (Math.random() - 0.5) * 3)
    .attr("r", d => sizeScale(d.size))
    .attr("fill", "#E50914")
    .attr("opacity", 0.45)
    .attr("stroke", "none")
    .on("mouseenter", function(event, d) {
      d3.select(this)
        .attr("opacity", 1)
        .attr("stroke", "#000")
        .attr("stroke-width", 1.5)
        .raise();
      
      const yearDisplay = d.releaseYear ? ` (${d.releaseYear})` : '';
      const runtimeDisplay = d.runtime ? `${d.runtime} min` : 'Runtime: n/a';
    const genreDisplay = d.genre ? d.genre.charAt(0).toUpperCase() + d.genre.slice(1) : 'Genre: n/a';
    const countryDisplay = d.country ? d.country : 'N/A';
    const posterImg = d.poster ? `<img src=\"${d.poster}\" alt=\"${d.title}\" class=\"matrix-tooltip-poster\" />` : '';
      const infoLine = matrixTypeFilter === 'all'
        ? `${d.type} · ${genreDisplay}`
        : `${genreDisplay}`;
      let left = event.pageX + 10;
      let top = event.pageY + 10;
      tooltip.classed("show", true)
        .style("left", `${left}px`)
        .style("top", `${top}px`)
        .html(`
          <div class="matrix-tooltip-content">
            ${posterImg}
            <div class="matrix-tooltip-text">
              <strong>${d.title}${yearDisplay}</strong><br>
              ${infoLine}<br>
              <span style="font-size: 12px; color: #666;">
                ${countryDisplay} · ${runtimeDisplay}<br>
                ${formatValue(d.hours)} hours · ${formatValue(d.views)} views
              </span>
            </div>
          </div>
        `);
      const node = tooltip.node();
      if (node) {
        const w = node.offsetWidth || 0;
        const h = node.offsetHeight || 0;
        const margin = 12;
        left = Math.min(left, window.innerWidth - w - margin);
        top = Math.min(top, window.innerHeight - h - margin);
        left = Math.max(margin, left);
        top = Math.max(margin, top);
        tooltip.style("left", `${left}px`).style("top", `${top}px`);
      }
    })
    .on("mouseleave", function() {
      d3.select(this)
        .attr("opacity", 0.45)
        .attr("stroke", "none");
      tooltip.classed("show", false);
    });

  // Quadrant labels on top of everything with soft backplates
  const labelGroup = svg.append("g")
    .attr("class", "quadrant-labels")
    .attr("pointer-events", "none");

  quadrantLabels.forEach(q => {
    const cardWidth = 280;
    const cardHeight = 84;
    const cardX = q.x - cardWidth / 2;
    const cardY = q.y - 40;

    labelGroup.append("rect")
      .attr("x", cardX)
      .attr("y", cardY)
      .attr("width", cardWidth)
      .attr("height", cardHeight)
      .attr("rx", 14)
      .attr("fill", "rgba(255,255,255,0.9)")
      .attr("stroke", "rgba(0,0,0,0.05)")
      .attr("stroke-width", 1)
      .attr("filter", "url(#label-glow)");

    labelGroup.append("text")
      .attr("x", q.x)
      .attr("y", q.y - 2)
      .attr("text-anchor", "middle")
      .attr("font-family", "'Schibsted Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif")
      .attr("font-size", "26px")
      .attr("font-weight", "800")
      .attr("fill", "#b01217")
      .text(q.title);
    
    labelGroup.append("text")
      .attr("x", q.x)
      .attr("y", q.y + 22)
      .attr("text-anchor", "middle")
      .attr("font-family", "'Schibsted Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif")
      .attr("font-size", "15px")
      .attr("font-weight", "400")
      .attr("fill", "#444")
      .text(q.subtitle);
  });

}

// Main Init
async function init() {
  const datasets = await Promise.all(CONFIG.files.map(async f => {
    const rows = await d3.csv(f.path);
    return rows.map(r => {
      // sanitize title field in-place for downstream uses
      r.Title = sanitizeTitle(r.Title || r.TitleCanonical || r.primaryTitle || r.originalTitle || r.name || '');
      // normalize runtime field in-place
      const runtimeNorm =
        parseRuntimeMinutes(r.Runtime) ??
        parseRuntimeMinutes(r.runtimeMinutes) ??
        parseRuntimeMinutes(r.averageRuntime) ??
        parseRuntimeMinutes(r.runtime) ??
        '';
      r.Runtime = runtimeNorm;
      const normalized = normalizeRow(r, f.type);
      // Preserve title and summary for keyword analysis
      normalized.Title = r.TitleCanonical || r.Title || r.primaryTitle || r.originalTitle || r.name || '';
      normalized.Summary = r.summary || ''; // TV shows have summaries
      // Preserve raw values for matrix calculations
      normalized._rawRow = r;
      return normalized;
    });
  }));
  const allRows = datasets.flat();

  // Educated guesses for any remaining N/A fields
  const runtimeBuckets = { Movie: [], TV: [] };
  allRows.forEach(r => {
    if (isFinite(r.Runtime) && r.Runtime > 0) {
      runtimeBuckets[r.Type] = runtimeBuckets[r.Type] || [];
      runtimeBuckets[r.Type].push(Number(r.Runtime));
    }
  });
  const median = arr => {
    if (!arr || !arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  const runtimeFallbacks = {
    Movie: median(runtimeBuckets.Movie),
    TV: median(runtimeBuckets.TV)
  };

  allRows.forEach(r => {
    // Runtime guess: use median per type if missing
    if (!isFinite(r.Runtime) || r.Runtime <= 0) {
      const guess = runtimeFallbacks[r.Type];
      if (guess) r.Runtime = guess;
    }
    // Release year guess: extract from title if missing
    if (!r.ReleaseYear) {
      const match = (r.Title || '').match(/\b(19|20)\d{2}\b/);
      if (match) r.ReleaseYear = match[0];
    }
    // Country guess: if still empty after heuristics, mark unknown
    if (!r.Country) {
      r.Country = 'Unknown';
    }
  });

  const expandedRows = SPLIT_MULTI_GENRES ? allRows.flatMap(r => r.Genres.map(g => ({ ...r, PrimaryGenre: g }))) : allRows;
  // Build title map for sunburst hover (Type, Type|Genre, Type|Genre|Language)
  sliceTitleMap = new Map();
  const addToMap = (key, entry) => {
    if (!entry.title || !entry.poster) return;
    if (!sliceTitleMap.has(key)) sliceTitleMap.set(key, []);
    const arr = sliceTitleMap.get(key);
    if (arr.some(e => e.title === entry.title && e.poster === entry.poster)) return; // avoid dup entries
    arr.push(entry);
  };
  expandedRows.forEach(r => {
    const t = r.Type;
    const g = r.PrimaryGenre;
    const l = r.Language;
    const posterUrl = normalizePoster(r.TMDBPoster);
    if (!posterUrl) return; // skip entries without a poster
    const cleanTitle = sanitizeTitle(r.Title || '');
    const year = r.ReleaseYear || '';
    if (!cleanTitle) return;
    const entry = { title: cleanTitle, poster: posterUrl, year };
    addToMap(t, entry);
    addToMap(`${t}|${g}`, entry);
    addToMap(`${t}|${g}|${l}`, entry);
  });
  
  // Store raw rows for matrix view (need both hours and views)
  allRawRows = datasets.flat().map(row => ({
    ...row._rawRow,
    Type: row.Type,
    PrimaryGenre: row.PrimaryGenre,
    Language: row.Language,
    Title: row.Title
  }));
  
  // Calculate matrix data (uses both hours and views)
  matrixData = calculateMatrixData(expandedRows.map(r => ({
    ...r._rawRow,
    Type: r.Type,
    PrimaryGenre: r.PrimaryGenre,
    Language: r.Language,
    Title: r.Title
  })));
  
  // Analyze keywords from titles
  keywordData = analyzeTitleKeywords(expandedRows);
  const aggMap = aggregateLeafTuples(expandedRows);
  const sequences = tuplesToSequences(aggMap);
  const root = buildHierarchy(sequences);
  const totalValue = d3.sum(expandedRows, r => r.Value);
  let totalText;
  if (VALUE_MODE === 'hours') {
    totalText = `Total data: ${formatValue(totalValue).replace('B', ' billion')} hours`;
  } else {
    totalText = `Total data: ${formatValue(totalValue).replace('B', ' billion')} streams`;
  }
  d3.select("#filteredTotal").text(totalText);
  renderSunburst(root);
  window.__netflixSunburstRoot = root;
}

// Controls
function setupControls() {
  const filterExplanation = document.getElementById('filter-explanation');
  const viewToggle = document.getElementById('view-toggle');
  const matrixFooter = document.getElementById('matrixFooter');
  const matrixFilter = document.getElementById('matrix-filter');
  const matrixDropdown = document.getElementById('matrixDropdown');
  const matrixDropdownToggle = document.getElementById('matrixDropdownToggle');
  const matrixDropdownMenu = document.getElementById('matrixDropdownMenu');
  const matrixDropdownLabel = document.getElementById('matrixDropdownLabel');
  const matrixHelp = document.getElementById('matrixHelp');
  const matrixHelpPopover = document.getElementById('matrixHelpPopover');
  const sliceHighlights = document.getElementById('slice-highlights');
  if (!viewToggle) return;

  const buttons = Array.from(viewToggle.querySelectorAll('button'));
  const pill = viewToggle.querySelector('.toggle-pill');
  const explanations = {
    hours: 'Measures the total amount of time viewers spent watching a title. Calculated in total hours viewed across all viewers.',
    views: 'Counts how many times a title was started. Each press of “play” counts as one view, no matter how long someone watched it for.',
    matrix: ''
  };

  const setActive = (view) => {
    buttons.forEach((btn, idx) => {
      const isActive = btn.dataset.view === view;
      btn.classList.toggle('active', isActive);
      if (isActive && pill) {
        const position = idx === 0 ? '3px' : idx === 1 ? 'calc(33.333% + 3px)' : 'calc(66.666% + 3px)';
        pill.style.left = position;
      }
    });
    if (filterExplanation) {
      if (view === 'matrix') {
        filterExplanation.style.display = 'none';
      } else {
        filterExplanation.style.display = 'block';
        filterExplanation.innerHTML = explanations[view] || '';
      }
    }
  };

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      
      if (view === 'matrix') {
        setActive(view);
        // Hide sunburst-specific elements
        const titleOverlay = document.getElementById('title-overlay');
        const filteredTotal = document.getElementById('filteredTotal');
        if (titleOverlay) titleOverlay.style.display = 'none';
        if (filteredTotal) filteredTotal.style.display = 'none';
        if (matrixFooter) matrixFooter.style.display = 'block';
        if (matrixFilter) matrixFilter.style.display = 'block';
        if (matrixHelp) matrixHelp.style.display = 'grid';
        if (matrixHelpPopover) matrixHelpPopover.style.display = 'none';
        if (sliceHighlights) {
          sliceHighlights.style.display = 'none';
          sliceHighlights.innerHTML = '';
        }
        d3.select("#breadcrumb").classed("show", false);
        // Render matrix view
        renderMatrix(matrixData);
        return;
      }
      
      // Show sunburst-specific elements
      const titleOverlay = document.getElementById('title-overlay');
      const filteredTotal = document.getElementById('filteredTotal');
      if (titleOverlay) titleOverlay.style.display = 'block';
      if (filteredTotal) filteredTotal.style.display = 'block';
      if (matrixFooter) matrixFooter.style.display = 'none';
      if (matrixFilter) matrixFilter.style.display = 'none';
      if (matrixHelp) matrixHelp.style.display = 'none';
      if (matrixHelpPopover) matrixHelpPopover.style.display = 'none';
      if (sliceHighlights) sliceHighlights.style.display = 'block';
      
      if (view !== VALUE_MODE) {
        VALUE_MODE = view;
        setActive(view);
        init();
      } else {
        setActive(view);
        // Re-render sunburst if switching from matrix
        if (window.__netflixSunburstRoot) {
          renderSunburst(window.__netflixSunburstRoot);
        }
      }
    });
  });

  // Custom dropdown interactions
  if (matrixDropdown && matrixDropdownToggle && matrixDropdownMenu && matrixDropdownLabel) {
    let closeTimer = null;
    const openMenu = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
      matrixDropdownMenu.style.display = 'block';
      requestAnimationFrame(() => {
        matrixDropdownMenu.style.opacity = '1';
        matrixDropdownMenu.style.transform = 'translateY(0)';
      });
      matrixDropdownToggle.setAttribute('aria-expanded', 'true');
    };
    const closeMenu = () => {
      matrixDropdownMenu.style.opacity = '0';
      matrixDropdownMenu.style.transform = 'translateY(4px)';
      matrixDropdownToggle.setAttribute('aria-expanded', 'false');
      closeTimer = setTimeout(() => {
        matrixDropdownMenu.style.display = 'none';
        closeTimer = null;
      }, 150);
    };
    matrixDropdown.addEventListener('mouseenter', openMenu);
    matrixDropdown.addEventListener('mouseleave', closeMenu);
    matrixDropdownMenu.addEventListener('mouseenter', openMenu);
    matrixDropdownMenu.addEventListener('mouseleave', closeMenu);
    matrixDropdownMenu.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => {
        matrixDropdownMenu.querySelectorAll('li').forEach(n => n.classList.remove('active'));
        li.classList.add('active');
        const val = li.dataset.value;
        matrixTypeFilter = val || 'all';
        matrixDropdownLabel.textContent = li.textContent;
        closeMenu();
        renderMatrix(matrixData);
      });
    });
  }

  setActive(VALUE_MODE);
}

// Rendering
// Rendering Helpers
function createPartitionAndRoot(data, radius) {
  const partition = d3.partition().size([2 * Math.PI, radius * radius]);
  const root = partition(d3.hierarchy(data).sum(d => d.value).sort((a, b) => b.value - a.value));
  return root;
}

function setupColorScales(root) {
  typeScale = d3.scaleOrdinal().domain(["Movie", "TV"]).range(["#E50914", "#B81D24"]);
  genreScale = d3.scaleOrdinal(["#DC143C", "#CD5C5C", "#F08080", "#FA8072", "#E9967A", "#FFB6C1", "#FFC0CB", "#FF7F50"]);
  languageScale = d3.scaleOrdinal(["#800000", "#8B0000", "#A0522D", "#A52A2A", "#C71585", "#FF0000", "#FF6347", "#FF4500", "#FF1493", "#8B4513", "#A0522D", "#B22222"]);
  const genres = new Set();
  root.descendants().forEach(d => {
    if (d.depth >= 2) {
      let node = d;
      while (node.depth > 2) node = node.parent;
      genres.add(node.data.name);
    }
  });
  genreScale.domain(Array.from(genres).sort());
}

function createArcs(radius) {
  const arc = d3.arc()
    .startAngle(d => d.x0)
    .endAngle(d => d.x1)
    .padAngle(d => Math.min(MIN_PAD_ANGLE, (d.x1 - d.x0) * 0.25))
    .padRadius(radius)
    .innerRadius(d => Math.sqrt(d.y0))
    .outerRadius(d => Math.max(Math.sqrt(d.y0) + MIN_ARC_WIDTH, Math.sqrt(d.y1) - 1));
  
  const mousearc = d3.arc()
    .startAngle(d => d.x0)
    .endAngle(d => d.x1)
    .innerRadius(d => Math.sqrt(d.y0))
    .outerRadius(radius);
  
  return { arc, mousearc };
}

function setupCenterLabel(svg) {
  const centerLabel = svg.append("g")
    .attr("class", "center-label");
  
  centerLabel.append("text")
    .attr("class", "center-pct")
    .attr("text-anchor", "middle")
    .attr("y", -8)
    .attr("font-family", "'Schibsted Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif")
    .text("");
  
  centerLabel.append("text")
    .attr("class", "center-desc")
    .attr("text-anchor", "middle")
    .attr("y", 20)
    .attr("font-family", "'Schibsted Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif")
    .text("");
  
  return centerLabel;
}

function setupTooltip() {
  return d3.select("#tooltip");
}

function setupBreadcrumb() {
  return d3.select("#breadcrumb");
}

function renderNodes(svg, root, arc, mousearc) {
  const nodes = svg.append("g")
    .selectAll("path")
    .data(root.descendants().filter(d => d.depth))
    .join("path")
    .attr("fill", d => colorForNode(d))
    .attr("fill-opacity", 1.0)
    .attr("d", arc);
  
  const mouseLayer = svg.append("g")
    .selectAll("path")
    .data(root.descendants().filter(d => d.depth))
    .join("path")
    .attr("fill", "none")
    .attr("pointer-events", "all")
    .attr("d", mousearc);
  
  return { nodes, mouseLayer };
}

function setupMouseEvents(mouseLayer, nodes, root, centerLabel, tooltip, breadcrumb, VALUE_MODE) {
  const formatPct = (value, total) => {
    const raw = 100 * value / total;
    return raw < 0.1 ? "<0.1" : raw.toFixed(1);
  };
  const sliceHighlights = document.getElementById('slice-highlights');
  const updateSliceHighlights = (node) => {
    if (!sliceHighlights || !sliceTitleMap) return;
    const type = node.depth >= 1 ? node.ancestors().find(a => a.depth === 1)?.data.name : null;
    const genre = node.depth >= 2 ? node.ancestors().find(a => a.depth === 2)?.data.name : null;
    const language = node.depth >= 3 ? node.data.name : null;
    const keys = [];
    if (language) keys.push(`${type}|${genre}|${language}`);
    if (genre) keys.push(`${type}|${genre}`);
    if (type) keys.push(type);
    let entries = [];
    for (const k of keys) {
      if (sliceTitleMap.has(k)) {
        entries = sliceTitleMap.get(k);
        break;
  }

  // Matrix help hover + click toggle
  if (matrixHelp && matrixHelpPopover) {
    let helpPinned = false;
    const showHelp = () => {
      matrixHelpPopover.classList.add('show');
      matrixHelpPopover.style.display = 'block';
    };
    const hideHelp = () => {
      if (!helpPinned) {
        matrixHelpPopover.classList.remove('show');
        matrixHelpPopover.style.display = 'none';
      }
    };
    matrixHelp.addEventListener('mouseenter', showHelp);
    matrixHelp.addEventListener('mouseleave', hideHelp);
    matrixHelp.addEventListener('click', () => {
      helpPinned = !helpPinned;
      if (helpPinned) showHelp();
      else hideHelp();
    });
  }
}
    // Require at least 3 distinct entries with posters; otherwise hide panel
    if (!entries || entries.length < SLICE_TITLES_COUNT) {
      sliceHighlights.style.display = 'none';
      sliceHighlights.innerHTML = '';
      return;
    }
    // Shuffle and take first 3 unique
    const pool = [...entries];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const picks = pool.slice(0, SLICE_TITLES_COUNT);
    sliceHighlights.style.display = 'block';
    sliceHighlights.innerHTML = `
      <span class="title">Examples in this slice</span>
      <div class="posters">
        ${picks.length ? picks.map(e => `
          <div class="poster-item">
            <div class="poster-img" style="background-image:url('${e.poster || 'https://via.placeholder.com/120x180?text=No+Poster'}');"></div>
            <div class="poster-title">
              <div class="poster-title-line">${e.title}</div>
              ${e.year ? `<div class="poster-year">(${e.year})</div>` : ''}
            </div>
          </div>
        `).join('') : '<div class="poster-item">No titles available</div>'}
      </div>
    `;
  };

  mouseLayer
    .on("mouseenter", function(event, d) {
      nodes.attr("fill-opacity", n => d.ancestors().includes(n) ? 1.0 : 0.3);
      d3.select("#title-overlay").style("opacity", 0);
      breadcrumb.classed("show", true);
      const pct = formatPct(d.value, root.value);
      centerLabel.select('.center-pct').text(`${pct}%`);
      const desc = formatCenterDesc(d, root, VALUE_MODE);
      const descEl = centerLabel.select('.center-desc');
      descEl.selectAll('tspan').remove();
      descEl.text("");
      const splitPhrase = VALUE_MODE === 'hours' ? ' went to ' : ' came from ';
      const parts = desc.split(splitPhrase);
      if (parts.length > 1) {
        descEl.append('tspan')
          .text(parts[0] + splitPhrase)
          .attr('x', 0)
          .attr('dy', 0);
        descEl.append('tspan')
          .text(parts[1])
          .attr('x', 0)
          .attr('dy', LINE_SPACING);
      } else {
        descEl.text(desc);
      }
      updateBreadcrumb(d, breadcrumb, root);
      const valueLabel = VALUE_MODE === "hours" ? "Watch Time" : "View Count";
      
      // Build tooltip content with keywords
      let tooltipContent = `${valueLabel}: ${formatValue(d.value)}`;
      const keywords = getTopKeywords(d, keywordData, 3);
      if (keywords && keywords.length > 0) {
        tooltipContent += `<br><span style="font-size: 12px; opacity: 0.9;">Top words: ${keywords.join(', ')}</span>`;
      }
      updateSliceHighlights(d);
      
      let left = event.pageX + 5, top = event.pageY + 5;
      tooltip.classed("show", true).style("left", `${left}px`).style("top", `${top}px`).html(tooltipContent);
      // Adjust position...
      const tooltipNode = tooltip.node();
      if (tooltipNode) {
        const tooltipWidth = tooltipNode.offsetWidth, tooltipHeight = tooltipNode.offsetHeight;
        if (left + tooltipWidth > window.innerWidth) left = event.pageX - 10 - tooltipWidth;
        if (top + tooltipHeight > window.innerHeight) top = event.pageY - 10 - tooltipHeight;
        if (left < 0) left = 10; if (top < 0) top = 10;
        tooltip.style("left", `${left}px`).style("top", `${top}px`);
      }
    })
    .on("mouseleave", function(event, d) {
      nodes.attr("fill-opacity", 1.0);
      d3.select("#title-overlay").style("opacity", 1);
      breadcrumb.classed("show", false);
      setCenterIdle(centerLabel, root);
      breadcrumb.html("");
      tooltip.classed("show", false);
      if (sliceHighlights) {
        sliceHighlights.style.display = 'none';
        sliceHighlights.innerHTML = '';
      }
    });
}

function updateBreadcrumb(d, breadcrumb, root) {
  const sequence = d.ancestors().reverse().slice(1).filter(n => n.data.name !== 'end').map(n => n.data.name);
  const percentage = (() => {
    const raw = 100 * d.value / root.value;
    return raw < 0.1 ? "<0.1" : raw.toFixed(1);
  })();
  breadcrumb.selectAll("*").remove();
  
  // Dimensions for better readability
  const svgBread = breadcrumb.append("svg")
    .attr("width", 1000)
    .attr("height", 42);
  
  let xOffset = 0;
  sequence.forEach((step, i) => {
    const displayStep = step; // Keep genres lowercase
    const textContent = i === sequence.length - 1 ? `${displayStep} (${percentage}%)` : displayStep;
    
    // Width calculation and height (match toggle height/padding)
    const width = textContent.length * 7.5 + 26;
    const height = 36;
    const topPad = 3; // centers polygon vertically within 42px
    
    const points = [
      [xOffset, topPad], 
      [xOffset + width - 10, topPad], 
      [xOffset + width, topPad + height / 2], 
      [xOffset + width - 10, topPad + height], 
      [xOffset, topPad + height]
    ];
    
    let fillColor = i === 0 ? typeScale(step) : i === 1 ? genreScale(step) : languageScale(step);
    
    svgBread.append("polygon")
      .attr("points", points.map(p => p.join(",")).join(" "))
      .attr("fill", fillColor)
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);
    
    svgBread.append("text")
      .attr("x", xOffset + width / 2)
      .attr("y", topPad + height / 2 + 4)
      .attr("text-anchor", "middle")
      .attr("fill", "#fff")
      .attr("font-size", 14)
      .attr("font-weight", 700)
      .attr("letter-spacing", "0.1px")
      .text(textContent);
    
    xOffset += width - 5;
  });
}

function renderSunburst(data) {
  const container = d3.select("#chart");
  container.selectAll("*").remove();
  const footerEl = document.getElementById('matrixFooter');
  const filteredTotalEl = document.getElementById('filteredTotal');
  if (footerEl) footerEl.style.display = 'none';
  if (filteredTotalEl) filteredTotalEl.style.display = 'block';
  const containerWidth = window.innerWidth;
  const containerHeight = window.innerHeight;
  const size = Math.min(containerWidth, containerHeight) * CHART_SIZE_RATIO;
  const radius = size / 2;
  const svg = container.append("svg")
    .attr("width", containerWidth)
    .attr("height", containerHeight)
    .style("display", "block")
    .append("g")
    .attr("transform", `translate(${containerWidth / 2},${containerHeight / 2})`);

  const root = createPartitionAndRoot(data, radius);
  setupColorScales(root);
  const { arc, mousearc } = createArcs(radius);
  const centerLabel = setupCenterLabel(svg);
  const tooltip = setupTooltip();
  const breadcrumb = setupBreadcrumb();
  const { nodes, mouseLayer } = renderNodes(svg, root, arc, mousearc);
  setupMouseEvents(mouseLayer, nodes, root, centerLabel, tooltip, breadcrumb, VALUE_MODE);
  setCenterIdle(centerLabel, root);
  centerLabel.raise();
}

// Helpers
function formatChildrenCategory(type, language = null) {
  // Special formatting for "children" genre to use apostrophe (children's)
  const formattedType = formatType(type);
  if (formattedType === 'TV') {
    return language ? `${language} children's TV` : "children's TV";
  }
  if (formattedType === 'movie') {
    return language ? `${language} children's movies` : "children's movies";
  }
  return null; // Not TV or Movie, handle elsewhere
}

function formatCenterDesc(d, root, VALUE_MODE) {
  const path = d.ancestors().reverse().slice(1).filter(n => n.data.name !== 'end');
  const [type, genre, language] = [path[0]?.data.name, path[1]?.data.name, path[2]?.data.name];
  const phrase = VALUE_MODE === 'hours' ? 'of all viewing time went to ' : 'of all streams came from ';
  const genreLower = genre?.toLowerCase() || '';
  const fmt = formatType(type);
  
  // Helper to build category string
  const buildCat = (lang, genreText, typeText) => {
    const parts = [lang, genreText, typeText].filter(Boolean);
    return parts.join(' ');
  };
  
  let cat = '';
  
  // Check for special "children" genre first
  if (genreLower === 'children') {
    cat = formatChildrenCategory(type, language) || buildCat(language, genreLower, pluralize(fmt));
  }
  // Type + Genre + Language
  else if (type && genre && language) {
    cat = fmt === 'TV' ? buildCat(language, 'TV', pluralize(genreLower)) :
          fmt === 'movie' ? buildCat(language, genreLower, 'movies') :
          buildCat(language, genreLower, pluralize(fmt));
  }
  // Type + Genre (no language)
  else if (type && genre) {
    cat = fmt === 'TV' ? buildCat(null, 'TV', pluralize(genreLower)) :
          fmt === 'movie' ? buildCat(null, genreLower, 'movies') :
          buildCat(null, genreLower, pluralize(fmt));
  }
  // Type + Language (no genre)
  else if (type && language) {
    cat = fmt === 'TV' ? `${language} TV shows` :
          fmt === 'movie' ? `${language} movies` :
          `${language} ${pluralize(fmt)}`;
  }
  // Only type, genre, or language
  else if (type) cat = fmt === 'TV' ? 'TV shows' : fmt === 'movie' ? 'movies' : pluralize(fmt);
  else if (genre) cat = pluralize(genreLower);
  else if (language) cat = `${language} titles`;
  
  // Don't capitalize - keep genres lowercase
  return phrase + cat + '.';
}

function formatTotalLine(root, VALUE_MODE) {
  const total = formatValue(root.value);
  return VALUE_MODE === 'hours' ? `100% of total watch time: ${total}` : `100% of total view count: ${total}`;
}

function setCenterIdle(centerLabel, root) {
  const descEl = centerLabel.select('.center-desc');
  centerLabel.select('.center-pct').text('100%');
  descEl.selectAll('tspan').remove();
  descEl.text("");
  const totalText = formatValue(root.value).replace('B', ' billion');
  const unit = VALUE_MODE === 'hours' ? 'hours were spent on Netflix.' : 'streams were logged on Netflix.';
  descEl.text(`${totalText} ${unit}`);
}

function colorForNode(d) {
  if (d.depth === 1) return typeScale(d.data.name);
  if (d.depth === 2) return genreScale(d.data.name);
  if (d.depth === 3) return languageScale(d.data.name);
  return "#fff";
}

// Resize
if (typeof window !== 'undefined') {
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!window.__netflixSunburstRoot) return;
    if (_resizeTimer) clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => renderSunburst(window.__netflixSunburstRoot), RESIZE_DEBOUNCE_MS);
  });
}

// Init
if (typeof d3 !== 'undefined') {
  init();
  setupControls();
}
