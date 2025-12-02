// Config
const CONFIG = {
  VALUE_MODE: "hours",
  SPLIT_MULTI_GENRES: true,
  valueFields: {
    hours: ["Watch Time", "watch_time", "WatchTime", "Hours Viewed", "hours_viewed", "HoursViewed"],
    views: ["View Count", "view_count", "ViewCount", "Views", "views"]
  },
  languageFields: ["language", "Language", "originalLanguage"],
  genreFields: ["genres", "Genres"],
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
    { path: "data/NetflixMovies_added.csv", type: "Movie" },
    { path: "data/NetflixTV_added.csv", type: "TV" }
  ]
};

// Constants
const CHART_SIZE_RATIO = 0.9; // Chart takes up 90% of viewport
const LINE_SPACING = '1.2em'; // Spacing between lines in center label
const RESIZE_DEBOUNCE_MS = 250; // Delay before re-rendering on window resize
const MIN_ARC_WIDTH = 2; // Minimum width of sunburst arcs

// Global State
let VALUE_MODE = CONFIG.VALUE_MODE;
let SPLIT_MULTI_GENRES = CONFIG.SPLIT_MULTI_GENRES;
let typeScale, genreScale, languageScale;
let keywordData = null; // Store keyword analysis results

// Utility Functions
const cleanGenre = g => g.replace(/[().,;!?']/g, '').trim();
const toNumber = x => {
  if (!x || x === "") return NaN;
  const s = String(x).replace(/,/g, "").trim();
  return +s.match(/^([0-9.]+)$/)?.[1] || +s;
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

  let rawGenres = row.genres?.trim() || row.Genres?.trim() || "Unspecified";
  const genres = String(rawGenres).split(/\s*[,|\/;]\s*/).map(s => s.trim()).filter(Boolean).map(g => {
    const cleaned = cleanGenre(g);
    return CONFIG.genreMap[cleaned.toLowerCase()] || cleaned;
  });
  const primaryGenre = genres[0] || "Unspecified";

  let vField = CONFIG.valueFields[VALUE_MODE].find(k => row[k] !== undefined);
  let num = toNumber(vField ? row[vField] : undefined);
  num = isFinite(num) && num >= 0 ? num : 0;

  return { Type: type, Language: lang, Genres: genres, PrimaryGenre: primaryGenre, Value: num };
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
  const stopWords = ['the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'with', 'from', 'by', 'this', 'that', 'will', 'who', 'what', 'when', 'where', 'how', 'their', 'into', 'out', 'about', 'after', 'his', 'her', 'she', 'they', 'them', 'series', 'movie', 'season', 'limited', 'some', 'life', 'world', 'every', 'story', 'while', 'being'];
  
  // Build a set of all title words to exclude from keyword analysis
  const titleWords = new Set();
  rows.forEach(row => {
    if (row.Title) {
      const words = row.Title.toLowerCase()
        .split(/[\s\-:.,;!?'"()\[\]]+/)
        .map(w => w.replace(/[^\w]/g, ''))
        .filter(w => w.length > 3 && /^[a-z]+$/.test(w));
      words.forEach(w => titleWords.add(w));
    }
  });
  
  rows.forEach(row => {
    // Create keys for both Type|Genre and Type|Genre|Language levels
    const genreKey = `${row.Type}|${row.PrimaryGenre}`;
    const langKey = row.Language ? `${row.Type}|${row.PrimaryGenre}|${row.Language}` : null;
    
    // Only use summary for TV shows (movies don't have meaningful summaries)
    let text = '';
    if (row.Type === 'TV' && row.Summary) {
      // Remove HTML tags from summary
      text = row.Summary.replace(/<[^>]*>/g, ' ').toLowerCase();
    }
    
    if (!text) return;
    
    // Split and filter words (exclude stop words and title words)
    const words = text
      .split(/[\s\-:.,;!?'"()\[\]]+/)
      .map(w => w.replace(/[^\w]/g, ''))
      .filter(w => w.length > 3 && !stopWords.includes(w) && /^[a-z]+$/.test(w) && !titleWords.has(w));
    
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

// Main Init
async function init() {
  const datasets = await Promise.all(CONFIG.files.map(async f => {
    const rows = await d3.csv(f.path);
    return rows.map(r => {
      const normalized = normalizeRow(r, f.type);
      // Preserve title and summary for keyword analysis
      normalized.Title = r.Title || r.primaryTitle || r.originalTitle || '';
      normalized.Summary = r.summary || ''; // TV shows have summaries
      return normalized;
    });
  }));
  const allRows = datasets.flat();
  const expandedRows = SPLIT_MULTI_GENRES ? allRows.flatMap(r => r.Genres.map(g => ({ ...r, PrimaryGenre: g }))) : allRows;
  
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
  if (!viewToggle) return;

  const buttons = Array.from(viewToggle.querySelectorAll('button'));
  const pill = viewToggle.querySelector('.toggle-pill');
  const explanations = {
    hours: 'Measures the total amount of time viewers spent watching a title. Calculated in total hours viewed across all viewers.',
    views: 'Counts how many times a title was started. Each press of “play” counts as one view, no matter how long someone watched it for.',
    matrix: 'Matrix view is coming soon.'
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
    if (filterExplanation) filterExplanation.innerHTML = explanations[view] || '';
  };

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view === 'matrix') {
        setActive(view);
        return;
      }
      if (view !== VALUE_MODE) {
        VALUE_MODE = view;
        setActive(view);
        init();
      } else {
        setActive(view);
      }
    });
  });

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
    .padAngle(1 / radius)
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
  mouseLayer
    .on("mouseenter", function(event, d) {
      nodes.attr("fill-opacity", n => d.ancestors().includes(n) ? 1.0 : 0.3);
      d3.select("#title-overlay").style("opacity", 0);
      breadcrumb.classed("show", true);
      const pct = (100 * d.value / root.value).toFixed(1);
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
    });
}

function updateBreadcrumb(d, breadcrumb, root) {
  const sequence = d.ancestors().reverse().slice(1).filter(n => n.data.name !== 'end').map(n => n.data.name);
  const percentage = (100 * d.value / root.value).toFixed(1);
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
  const size = Math.min(window.innerWidth, window.innerHeight) * CHART_SIZE_RATIO;
  const radius = size / 2;
  const svg = container.append("svg")
    .style("display", "block")
    .style("margin", "auto")
    .append("g")
    .attr("transform", `translate(${size/2},${size/2})`);

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
