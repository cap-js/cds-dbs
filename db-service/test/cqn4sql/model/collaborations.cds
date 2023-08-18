// inspired by a customer bug report
// where a nested expand on an association with
// multiple conditions next to the `$self` backlink led to issues
aspect cuid {
  key id: Integer;
}

entity Collaborations : cuid {
  subCollaborations: Composition of many SubCollaborations on subCollaborations.collaboration = $self;
  leads           : Association to many CollaborationLeads on leads.collaboration = $self and leads.isLead = true;
  collaborationLogs: Association to many CollaborationLogs on collaborationLogs.collaboration = $self;
  activeOwners: Association to ActiveOwners on activeOwners.collaboration = $self;
}
entity ActiveOwners : cuid {
  collaboration: Association to Collaborations;
  owner_userID: Int16;
}
entity SubCollaborations : cuid {
    collaboration: Association to Collaborations;
    leads           : Association to many SubCollaborationAssignments on leads.subCollaboration = $self and leads.isLead = true;
}

entity CollaborationLeads: cuid {
  collaboration: Association to Collaborations;
  scholar_userID: Int16;
  participant: Association to CollaborationParticipants;
  isLead: Boolean;
}

entity SubCollaborationAssignments : cuid {
    subCollaboration : Association to one SubCollaborations;
    isLead           : Boolean default false;
    participant: Association to CollaborationParticipants;
}
entity CollaborationParticipants : cuid {
  scholar_userID: Int16;
}
entity CollaborationApplications : cuid {
    subCollaborations: Composition of many SubCollaborationApplications on subCollaborations.application = $self;
}

entity SubCollaborationApplications : cuid {
    application      : Association to one CollaborationApplications;
}

entity CollaborationLogs : cuid {
  collaboration: Association to Collaborations;
}
