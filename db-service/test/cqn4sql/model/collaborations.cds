// inspired by a customer bug report
// where a nested expand on an association with
// multiple conditions next to the `$self` backlink led to issues
aspect cuid {
  key id: Integer;
}

entity Collaborations : cuid {
  subCollaborations: Composition of many SubCollaborations on subCollaborations.collaboration = $self;
  leads           : Association to many CollaborationLeads on leads.collaboration = $self and leads.isLead = true;
}
entity SubCollaborations : cuid {
    collaboration: Association to Collaborations;
    leads           : Association to many SubCollaborationAssignments on leads.subCollaboration = $self and leads.isLead = true;
}

entity CollaborationLeads: cuid {
  collaboration: Association to Collaborations;
  isLead: Boolean;
}

entity SubCollaborationAssignments : cuid {
    subCollaboration : Association to one SubCollaborations;
    isLead           : Boolean default false;

}
entity CollaborationParticipants : cuid {
}
entity CollaborationApplications : cuid {
    subCollaborations: Composition of many SubCollaborationApplications on subCollaborations.application = $self;
}

entity SubCollaborationApplications : cuid {
    application      : Association to one CollaborationApplications;
}
