namespace complex.associations.unmanaged;

entity Books {
  key ID        : Integer;
      title     : String(111);
      author_ID : Integer;
      author    : Association to Authors
                    on author.ID = $self.author_ID;
}

entity Authors {
  key ID     : Integer;
      name   : String(111);
      books  : Association to many Books
                 on books.author = $self;
      static : Association to many Books
                 on  static.author =  $self
                 and static.ID     >  0
                 and name          != null;
}

// ---

entity LeftChild {
  key ID    : UUID;
      title : String;
}

entity RightChild {
  key ID    : UUID;
      title : String;
}

entity WithRelationship {
  key leftChildId  : UUID;
  key rightChildId : UUID;
      leftChild    : Association to one LeftChild
                       on leftChild.ID = $self.leftChildId;
      rightChild   : Association to one RightChild
                       on rightChild.ID = $self.rightChildId;
}
