# CDS database service fractal service

Welcome to the new fractal database service for [SAP Cloud Application Programming Model](https://cap.cloud.sap) Node.js, based on new, streamlined database architecture. Levarging the inter changable behavior of the new database services to reduce request latency.

## Concept

The fundamentals of this service is to take temporary responsability of an isolated section of the database. Which allows the local cache to execute all actions directly on the cache. Reducing the load on the source database. While also retaining data consistency across all instances. When ever a service instance wants to access the database they request for access tokens from instance 0. As all instances request access tokens from instance 0. It is possible to identify traffic on the application and instruct any instance to take owner ship of a database section. When other instances want to access the same database section. They will be directed by instance 0 to the current owner. Which allows the owner to make all queries onto its cache. Once the demand has normalized the cache is flushed back to the source database. Resulting in the source database becoming the owner once again of the data.


### Proof of Concept

Even when taking this concept to a very simplistic scenario the effects are noticeble.

When sending a simple `SELECT * FROM Books` in rapid succession. A local cache is initialized and kept for a short period of time. Before flushing it back to the source database. When the cache is not yet updated the scenario is `cold`. When the cache is already up-to-date the scenario is `warm`. It is clear that the `cold` scenario needs to first execute a `SELECT` to `UPSERT` the current state into the cache. Once this is done the successive `SELECT` queries are executed much faster. With the added benefit without putting any stress on the source database. Allowing this approach to scale past the size of the source database. While even improving the performance of all queries not currently cached. As the source database will be using much less resources.

| queries | fractal(sqlite cache) | postgres |
| --- | --- | --- |
| 1 cold | 5ms | 5ms |
| 10 cold | 11ms | 28ms |
| 10 warm | 4ms | ~ |
| 100 cold | 42ms | 256ms |
| 100 cold | 30ms | ~ |
| 1000 cold | 338ms | 2397ms |
| 1000 warm | 302ms | ~ |
