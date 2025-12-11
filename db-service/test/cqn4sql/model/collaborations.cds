// inspired by a customer bug report
// where a nested expand on an association with
// multiple conditions next to the `$self` backlink led to issues

entity Collaborations {
  key id : Int16;
  subCollaborations: Composition of many SubCollaborations on subCollaborations.collaboration = $self;
  leads           : Association to many CollaborationLeads on leads.collaboration = $self and leads.isLead = true;
  collaborationLogs: Association to many CollaborationLogs on collaborationLogs.collaboration = $self;
  activeOwners: Association to ActiveOwners on activeOwners.collaboration = $self;
}
entity ActiveOwners {
  key id : Int16;
  collaboration: Association to Collaborations;
  owner_userID: Int16;
}
entity SubCollaborations {
    key id : Int16;
    collaboration: Association to Collaborations;
    leads           : Association to many SubCollaborationAssignments on leads.subCollaboration = $self and leads.isLead = true;
}

entity CollaborationLeads {
  key id : Int16;
  collaboration: Association to Collaborations;
  scholar_userID: Int16;
  participant: Association to CollaborationParticipants;
  isLead: Boolean;
}

entity SubCollaborationAssignments {
    key id : Int16;
    subCollaboration : Association to one SubCollaborations;
    isLead           : Boolean default false;
    participant: Association to CollaborationParticipants;
}
entity CollaborationParticipants {
  key id : Int16;
  scholar_userID: Int16;
}
entity CollaborationApplications {
    key id : Int16;
    subCollaborations: Composition of many SubCollaborationApplications on subCollaborations.application = $self;
}

entity SubCollaborationApplications {
    key id : Int16;
    application      : Association to one CollaborationApplications;
}

entity CollaborationLogs {
  key id : Int16;
  collaboration: Association to Collaborations;
}
