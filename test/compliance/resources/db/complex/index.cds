namespace complex;

using from './computed';
using from './associations';
using from './associationsUnmanaged';
using from './uniques';
using from './keywords';

entity Root {
  key ID       : Integer;
      fooRoot  : String;
      children : Composition of many Child
                   on children.parent = $self;
}

entity Child {
  key ID       : Integer;
      fooChild : String;
      parent   : Association to one Root;
      children : Composition of many GrandChild
                   on children.parent = $self
}

entity GrandChild {
  key ID            : Integer;
      fooGrandChild : String;
      parent        : Association to one Child;
}

entity RootPWithKeys   as
  projection on Root {
    key ID,
        fooRoot,
        children
  }

entity ChildP          as
  projection on Child {
    key ID,
        fooChild,
        parent
  }

entity ChildPWithWhere as projection on Child where fooChild = 'bar'
