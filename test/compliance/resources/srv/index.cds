using {complex as my} from '../db/complex';

service ComplexService @(path:'/comp') {
    entity RootP  as
        projection on my.Root {
            key ID,
            fooRoot,
            children
        };

    entity ChildP as
        projection on my.Child {
            key ID,
            fooChild,
            parent
        }
}
