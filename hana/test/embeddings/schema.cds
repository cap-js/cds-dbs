entity Books {
  key ID : Integer;
  embedding : Vector;
  @cds.embeddings.model: 'special-embeddings'
  annotated : Vector;
  text : String;
  @cds.embeddings.model: 'special-embeddings'
  calculated : Vector = vector_embedding(text) stored;
}
