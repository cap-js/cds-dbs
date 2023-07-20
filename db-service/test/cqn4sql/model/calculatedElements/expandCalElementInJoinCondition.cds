// infix filter in calc element definition is only relevant for join condition
namespace second;
entity E {
  key ID : Integer;
  f : Association to F;
  // ---
  c = f[c>2].n;
}

entity F {
  key ID : Integer;
  m : Integer;
  n : Integer;
  // ---
  c = m*n;
}
