// model to test some special join cases
// see assoc2joins.test.js --> 'References to target side via dummy filter'
service S {

  entity Source {
    key sourceID: String;
    toMid: Association to Mid { toTarget };
  }

  entity Mid {
    key midID: String;
    toTarget: Association to Target { toSource };
  }

  entity Target {
    key targetID: String;
    field: String;
    toSource: Association to Source;
  }
}
