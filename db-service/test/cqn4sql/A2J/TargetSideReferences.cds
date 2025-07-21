// By using an empty filter, we refer to the target side, not the foreign key.
//
// FIXME: https://github.tools.sap/cap/cds-compiler/issues/13960

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
