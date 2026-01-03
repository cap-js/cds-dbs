using {CatalogService} from '../../test/bookshop/apis/CatalogService';

service integration {
  entity Genres as projection on CatalogService.Genres;
  entity Books  as projection on CatalogService.ListOfBooks;
}
