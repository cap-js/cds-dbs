using {complex} from '../db/index.cds';

service ComplianceService {
  entity Books as projection on complex.Books;
}
