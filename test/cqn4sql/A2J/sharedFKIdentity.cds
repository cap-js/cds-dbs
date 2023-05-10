// Resolve correct foreign key if multiple FKs share the same
// target element (here C:c.d.e.ID)

entity C  {
    key c { d { e { ID : String(30); } } };
}

entity A  {
  // toB has two FKs
  // a_b_c_toB_foo_boo with access path a.b.c.toB.b.c.d.parent.c.d.e.ID
  // a_b_c_toB_bar_bas with access path a.b.c.toB.e.f.g.child.c.d.e.ID
  // both FKs end up in same target element C:c.d.e.ID, artifact identity is
  // not sufficient to identify the correct foreign key
  key a { b { c { toB : Association to B { b.c.d.parent as foo, e.f.g.child as bar } } } };
}

entity B {
  key b { c { d { parent : Association to C { c.d.e.ID as boo }; }; }; };
  key e { f { g { child  : Association to C { c.d.e.ID as bas }; }; }; };
}
