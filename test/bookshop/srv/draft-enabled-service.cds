service DraftService {
  @odata.draft.enabled
  entity DraftEnabledBooks
  {
    key ID : Integer;
    title : String;
  }
}