using { sap.capire.bookshop as my } from '../db/schema';

@path: '/test'
service TestService {
  entity Genres as projection on my.Genres;
}

annotate my.Genres:children with @depth: 5;
