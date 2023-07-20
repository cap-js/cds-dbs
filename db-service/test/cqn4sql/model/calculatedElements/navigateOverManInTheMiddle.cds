// for "E:cfg" we need two joins, but only TA of the
// last join is used within the query
namespace first;
entity E {
  key ID : Integer;
  f : Association to F;
  // ---
  cfg = f.cg;
}

entity F {
  key ID : Integer;
  g : Association to G;
  // ---
  cg = g.c;
}

entity G {
  key ID : Integer;
  x : Integer;
  y : Integer;
  // ---
  c = x + y;
}
