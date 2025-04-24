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
    // enable once https://github.com/cap-js/cds-dbs/pull/1156 is merged
    // assert.constraint.thirdEditingConstraint : {
    //     condition : (not exists footnotes[contains(text, 'FORBIDDEN PHRASE')]),
    //     message   : 'The phrase "FORBIDDEN PHRASE" is not allowed in footnotes',
    // }

);

annotate my.Books : stock with @(assert.constraint.stockNotEmpty: {
    condition : (stock >= 0),
    message   : 'STOCK_NOT_EMPTY',
    parameters: {
        title: (title),
        ID   : (ID)
    }
});

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