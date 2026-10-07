namespace existsInCalcElement;

entity Projects {
  key ID      : UUID;
      title   : String;
      members : Composition of many Members
                  on members.project = $self;
      tasks   : Composition of many Tasks
                  on tasks.project = $self;
      isUserNotMember : Boolean =
        (not exists members[userID = $user.id] ? true : false);
}

entity Members {
  key ID      : UUID;
      project : Association to one Projects;
      userID  : String;
}

entity Tasks {
  key ID      : UUID;
      project : Association to one Projects;
      title   : String;
      isUserNotMember : Boolean =
        (project.isUserNotMember = true ? true : false);
}
