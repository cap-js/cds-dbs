# Hierarchy Performance Comparisons

Here for each database a single database connection is used. As SQLite can only run on a single thread...

## HANA (CPU: 125% peak)

baseline                                             256 req/s     0 MiB/s     3 ms
TopLevels(1)                                         216 req/s     0 MiB/s     4 ms
TopLevels()                                          254 req/s     0 MiB/s     3 ms
ancestors($filter)/TopLevels(1)                      196 req/s     0 MiB/s     4 ms
ancestors($filter)/TopLevels()                       203 req/s     0 MiB/s     4 ms

## Postgres (CPU: 25% peak)

baseline                                             277 req/s     0 MiB/s     3 ms
TopLevels(1)                                         216 req/s     0 MiB/s     4 ms
TopLevels()                                          226 req/s     0 MiB/s     4 ms
ancestors($filter)/TopLevels(1)                      205 req/s     0 MiB/s     4 ms
ancestors($filter)/TopLevels()                       214 req/s     0 MiB/s     4 ms

## SQlite (CPU: 110% peak)

baseline                                             920 req/s     2 MiB/s     0 ms
TopLevels(1)                                         384 req/s     0 MiB/s     2 ms
TopLevels()                                          390 req/s     0 MiB/s     2 ms
ancestors($filter)/TopLevels(1)                      205 req/s     0 MiB/s     4 ms
ancestors($filter)/TopLevels()                       205 req/s     0 MiB/s     4 ms
