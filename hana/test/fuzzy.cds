using {sap.capire.bookshop.BooksAnnotated as BooksAnnotated} from '../../test/bookshop/db/schema.cds';

annotate BooksAnnotated with @cds.search: {title, descr, currency.code};
annotate BooksAnnotated:title with @(Search.ranking: HIGH, Search.fuzzinessThreshold: 0.9);
annotate BooksAnnotated:descr with @(Search.ranking: LOW, Search.fuzzinessThreshold: 0.9);