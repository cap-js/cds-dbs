namespace basic.projection;

using {basic.literals} from './literals';

entity globals  as projection on literals.globals;
entity number   as projection on literals.number;
entity string   as projection on literals.string;
entity date     as projection on literals.date;
entity time     as projection on literals.time;
entity dateTime as projection on literals.dateTime;
