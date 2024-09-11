using { sap.capire.bookshop as my } from '../db/schema';
service DraftService {
  @odata.draft.enabled
  entity DraftEnabledBooks
  {
    key ID : Integer;
    title : String;
  }

  @odata.draft.enabled
  entity MoreDraftEnabledBooks as projection on my.Books;
}
