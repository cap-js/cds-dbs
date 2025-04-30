using {sap.capire.bookshop as my} from './schema';

annotate my.Pages with @(
    assert.constraint.firstEditingConstraint : {
        condition : (length(footnotes.text) < length(text)),
        parameters: {
            footnoteLength: (length(footnotes.text)),
            pageLength    : (length( /* $self. */ text)),
            pageNumber    : (number),
            bookTitle     : (book.title),
        },
        message   : 'FOOTNOTE_TEXT_TOO_LONG',
    },
    assert.constraint.secondEditingConstraint: {
        condition : (length(text) > 0),
        parameters: {
            pageLength: (length( /* $self. */ text)),
            pageNumber: (number),
            bookTitle : (book.title),
        },
        message   : 'PAGE_TEXT_TOO_SHORT',
    },
    assert.constraint.thirdEditingConstraint : {
        condition : (not exists footnotes[contains(text, 'FORBIDDEN PHRASE')]),
        message   : 'The phrase "FORBIDDEN PHRASE" is not allowed in footnotes',
    }

);

annotate my.Books with @(
    assert.constraint.stockNotEmpty: {
        condition : (stock >= 0),
        message   : 'STOCK_NOT_EMPTY',
        parameters: {
            title: (title),
            ID   : (ID)
        }
    },
    assert.constraint.withCalculatedElement: {
        condition : (potentialRevenue <= 10000),
        message   : 'POTENTIAL_REVENUE_TOO_HIGH',
        parameters: {
            title: (title),
            ID   : (ID),
            value: (potentialRevenue)
        }
    }
);

annotate my.Authors with @(
    assert.constraint.dates : {
    condition: ( days_between(dateOfBirth, dateOfDeath) >= 0 ),
    message: 'LIFE_BEFORE_DEATH',
    parameters: [(dateOfBirth), (name), (dateOfDeath)]
}
);


annotate my.Genres : name with @(
    assert.constraint.name: {
    condition : (length(name) <= 25),
    parameters: [
        (name),
        (length(name))
    ],
    message   : 'GENRE_NAME_TOO_LONG'
}
);


annotate my.B with @(assert.constraint.foreign: {
    condition: (A != 42),
     message: 'A must not be 42',
    }
);