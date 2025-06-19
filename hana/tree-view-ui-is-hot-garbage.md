When you first click `go`, `filter` and `expand` you get the following (correct) request:

```js
ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(name eq 'Fantasy'),keep start)
/com.sap.vocabularies.Hierarchy.v1.TopLevels(
  HierarchyNodes=$root/GenreHierarchy,
  HierarchyQualifier='GenreHierarchy',
  NodeProperty='ID',
  Levels=1,
  ExpandLevels=[{"NodeID":"8bbf14c6-b378-4e35-9b4f-5a9c8b8762da","Levels":1}]
)
```

When you first `filter`, `go` and `expand` you get the following (WRONG) request:

```js
ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(name eq 'Fantasy'),keep start)
/descendants(
  $root/GenreHierarchy,
  GenreHierarchy,
  ID,
  filter(ID eq 8bbf14c6-b378-4e35-9b4f-5a9c8b8762da),
  1
)
```

There is no excuse for the UI to create two completely different requests for the exact same data requested. They are just so detached from reality that they make this mess.

I don't even know what happened anymore, but the UI thought that this was a reasonable request. I did `go` expanded some levels then I filtered the `Genre` for something that didn't exist got an empty result back as it should have and then searched for the exact same term and the UI came up with the following mess of a request. It skips the root level which means expand everything and then still decided to include the expanded levels for shits and giggles I guess.

```js
ancestors($root/GenreHierarchy,GenreHierarchy,ID,search(Distopian),keep start)
/com.sap.vocabularies.Hierarchy.v1.TopLevels(
  HierarchyNodes=$root/GenreHierarchy,
  HierarchyQualifier='GenreHierarchy',
  NodeProperty='ID',
  ExpandLevels=[{"NodeID":"8bbf14c6-b378-4e35-9b4f-5a9c8b8762da","Levels":1},{"NodeID":"86e9f4d5-3e7c-4c06-8421-8b6d72fe9c93","Levels":1}]
)
```

Just in case it wasn't clear the actual request the UI should have send is just this:

```js
ancestors($root/GenreHierarchy,GenreHierarchy,ID,search(Distopian),keep start)
/com.sap.vocabularies.Hierarchy.v1.TopLevels(
  HierarchyNodes=$root/GenreHierarchy,
  HierarchyQualifier='GenreHierarchy',
  NodeProperty='ID'
)
```

Another next level garbage request with toplevel:null and expand levels.
Steps to reproduce:
1. search: `Fan`
1. `go`
1. clear search
1. `go`
1. Collapse `Fantasy`
1. filter: Genre for `Fantasy`
1. `go`
1. Get no results =_=

```
ancestors($root/GenreHierarchy,GenreHierarchy,ID,filter(name eq 'Fantasy'),keep start)
/com.sap.vocabularies.Hierarchy.v1.TopLevels(
  HierarchyNodes=$root/GenreHierarchy,
  HierarchyQualifier='GenreHierarchy',
  NodeProperty='ID',
  ExpandLevels=[{"NodeID":"445a6c1e-071f-4e9d-b0bb-670ec73b0a49","Levels":0}]
)
```

the `recurse.where` is also super confused:

```js
{
  "ref":["parent"],
  "where":[
    {"ref":["ID"]},"=",{"val":"445a6c1e-071f-4e9d-b0bb-670ec73b0a49"},
    "and",
    {"ref":["Distance"]},"between",{"val":1},"and",{"val":0} // between 1 and 0 will never be true in SQL specifications
  ]
}
```

It just keeps coming, but now without the ancestors:

```js
com.sap.vocabularies.Hierarchy.v1.TopLevels(
  HierarchyNodes=$root/GenreHierarchy,
  HierarchyQualifier='GenreHierarchy',
  NodeProperty='ID',
  ExpandLevels=[{"NodeID":"7c7b2c30-c24e-4627-bb84-0f9d09f9e91b","Levels":0}]
)
```

With this quality of UI state handling we are decades away from implementing all the technical debt required to correct for the UI mistakes in the server implementation.
