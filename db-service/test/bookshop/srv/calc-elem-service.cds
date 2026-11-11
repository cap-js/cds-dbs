service CalcService {
  @odata.draft.enabled
  entity Orders {
    key ID: Integer;
    amount: Integer;
    expensive: Integer = amount > 10 ? 1: 0;
  }

  @odata.draft.enabled
  entity DraftCalculations as select from Orders {
    ID, amount,
    virtual null as plannedDuration: Integer,
    virtual 3 as approvalType: Integer,
    virtual amount + 1 as nextValue: Integer
  };
}
