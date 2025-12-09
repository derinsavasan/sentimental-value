# Sentimental Value

Sentimental Value breaks Netflix’s first six months of 2025 into three parts: watch time, view count, and a sentiment matrix built from engagement depth vs. reach. The matrix ranks titles by hours-per-view (x-axis: skimmed → stuck with) and total hours (y-axis: niche → mainstream), then clusters the scatter into four viewing modes: Prestige Pick, Crowd Pleaser, Background Noise, and Comfort Rewatch.

## Sources

- Internal Netflix viewing metrics (watch time, view count, 2025 H1)
- Enriched title metadata from APIs: [TMDB](https://www.themoviedb.org/?language=en-US) + [OMDb](https://www.omdbapi.com) (genres, runtime, language, country, posters)
- Manual keyword normalization for sentiment mapping and title cleaning

## WIP & Sketches

- [Quantiative draft](https://github.com/derinsavasan/info-aesthetics/tree/main/exercises/netflix-sunburst-quant), [Qualitative draft](https://github.com/derinsavasan/info-aesthetics/tree/main/exercises/netflix-sunburst-qual), [Geospatial draft](https://github.com/derinsavasan/info-aesthetics/tree/main/exercises/imdb-map-me)
- [Sketches PDF](https://github.com/derinsavasan/info-aesthetics/blob/main/exercises/netflix-sketches.pdf)

## Screenshots

<img src="screenshots/1-watch-time.png" alt="Watch Time" />
<img src="screenshots/2-view-count.png" alt="View Count" />
<img src="screenshots/3-matrix-movies.png" alt="Matrix – Movies" />
<img src="screenshots/4-matrix-tv.png" alt="Matrix – TV" />
<img src="screenshots/5-matrix-all.png" alt="Matrix – All" />
<img src="screenshots/6-legend.png" alt="Matrix Legend" />
