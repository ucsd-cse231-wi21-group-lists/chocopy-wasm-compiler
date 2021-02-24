import * as A from './ast';
import * as I from './ir';

const nameCounters : Map<string, number> = new Map();
function generateName(base : string) : string {
  if(nameCounters.has(base)) {
    var cur = nameCounters.get(base);
    nameCounters.set(base, cur + 1);
    return base + cur;
  }
  else {
    nameCounters.set(base, 1);
    return base + 1;
  }
}

function flattenStmt<A>(s : A.Stmt<A>) : [Array<I.Stmt<A>>, I.Stmt<A>] {
  switch(s.tag) {
    case "field-assign":
      var [ostmts, oval] = flattenExprToVal(s.obj);
      var [nstmts, nval] = flattenExprToVal(s.value);
      return [[...ostmts, ...nstmts], {
        tag: "field-assign",
        a: s.a,
        obj: oval,
        field: s.field,
        value: nval
      }];
  }

}

function flattenExprToVal<A>(e : A.Expr<A>) : [Array<I.Stmt<A>>, I.Value<A>] {
  switch(e.tag) {
    case "binop":
      var [lstmts, lval] = flattenExprToVal(e.left);
      var [rstmts, rval] = flattenExprToVal(e.right);
      var newName = generateName("binop");
      var setNewName : I.Stmt<A> = {
        tag: "assign",
        a: e.a,
        name: newName,
        value: {
          tag: "binop",
          op: e.op,
          left: lval,
          right: rval
        }
      };
      return [[...lstmts, ...rstmts, setNewName], {tag: "id", name: newName}];
  }
}