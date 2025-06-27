using {sap.capire.bookshop.BooksAnnotated as BooksAnnotated, sap.capire.bookshop.BooksAnnotatedScore1 as BooksAnnotatedScore1} from '../../test/bookshop/db/schema.cds';

annotate BooksAnnotated with @cds.search: {title, descr, currency.code};
annotate BooksAnnotated:title with @(Search.ranking: HIGH, Search.fuzzinessThreshold: 0.9);
annotate BooksAnnotated:descr with @(Search.ranking: LOW, Search.fuzzinessThreshold: 0.9);

annotate BooksAnnotatedScore1 with @cds.search: {title, descr, currency.code};
annotate BooksAnnotatedScore1:title with @(Search.ranking: HIGH, Search.fuzzinessThreshold: 0.9);
annotate BooksAnnotatedScore1:descr with @(Search.ranking: LOW, Search.fuzzinessThreshold: 1);