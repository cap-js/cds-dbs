service CalcService {
  @odata.draft.enabled
  entity Orders {
    key ID: Integer;
    amount: Integer;
    expensive: Integer = amount > 10 ? 1: 0;
  }
}