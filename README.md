# Sentimental Value

Sentimental Value maps Netflix’s first six months of 2025 viewing data across three lenses: watch time, view count, and an emotional “sentiment matrix.” Sunburst layers move from format → genre → language, scaled by either hours watched or streams. The matrix repositions every title by emotional valence (cold → warm) and narrative intensity (flat → charged), revealing four viewing modes: prestige pieces, crowd-pleasers, background filler, and comfort rewatches. Hover, filter, and sample posters to see how titles cluster—and how enriched metadata (genre, runtime, country, language, posters) changes the story.

## Sources

- Internal Netflix viewing metrics (watch time, view count, 2025 H1)
- Enriched title metadata from APIs: [TMDB](https://www.themoviedb.org/?language=en-US) + [OMDb](https://www.omdbapi.com) (genres, runtime, language, country, posters)
- Manual keyword normalization for sentiment mapping and title cleaning

## WIP Drafts

- Data enrichment scripts and cache (`scripts/enrich_tmdb.js`, `.tmdb_cache.json`)
- Intermediate enriched CSVs (`data/NetflixMovies_enriched.csv`, `data/NetflixTV_enriched.csv`)

## Screenshots

![Landing]()
![Watch Time]()
![View Count]()
![Matrix]()
![Poster Highlights]()
![Dropdown Filter]()
![Tooltip]()
