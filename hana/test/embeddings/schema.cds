entity Books {
  key ID : Integer;
  embedding : Vector;
  @cds.embeddings.model: 'special-embeddings'
  annotated : Vector;
}
