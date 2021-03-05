import { parser } from "lezer-python";
import { TreeCursor } from "lezer-tree";
import {
  Program,
  Expr,
  Stmt,
  UniOp,
  BinOp,
  Parameter,
  Type,
  FunDef,
  VarInit,
  Class,
  Literal,
  Scope,
  AssignTarget,
  Destructure,
  ASSIGNABLE_TAGS,
  Location,
} from "./ast";

import { NUM, BOOL, NONE, CLASS, isTagged, STRING, LIST } from "./utils";
import * as BaseException from "./error";

export function getSourcePos(c: TreeCursor, s: string): Location {
  const substring = s.substring(0, c.node.from);
  const line = substring.split("\n").length;
  const prevContent = substring
    .split("\n")
    .slice(0, line - 1)
    .join("\n");
  const col = c.node.from - prevContent.length;
  return {
    line: line,
    col: col,
    length: c.node.to - c.node.from,
  };
}

export function traverseLiteral(c: TreeCursor, s: string): Literal {
  var location: Location = getSourcePos(c, s);
  switch (c.type.name) {
    case "Number":
      return {
        tag: "num",
        value: BigInt(s.substring(c.from, c.to)),
      };
    case "String":
      const str = s.substring(c.from, c.to);
      const str_trimmed = str.substring(1, str.length - 1);
      return {
        tag: "string",
        value: str_trimmed,
      };
    case "Boolean":
      return {
        tag: "bool",
        value: s.substring(c.from, c.to) === "True",
      };
    case "None":
      return {
        tag: "none",
      };
    default:
      throw new BaseException.CompileError(location, "not literal", "ParsingError");
  }
}

export function traverseExpr(c: TreeCursor, s: string): Expr<Location> {
  var location: Location = getSourcePos(c, s);
  switch (c.type.name) {
    case "Number":
    case "String":
    case "Boolean":
    case "None":
      return {
        a: location,
        tag: "literal",
        value: traverseLiteral(c, s),
      };
    case "VariableName":
      return {
        a: location,
        tag: "id",
        name: s.substring(c.from, c.to),
      };
    case "CallExpression":
      c.firstChild();
      const callExpr = traverseExpr(c, s);
      c.nextSibling(); // go to arglist
      let args = traverseArguments(c, s);
      c.parent(); // pop CallExpression

      if (callExpr.tag === "lookup") {
        return {
          a: location,
          tag: "method-call",
          obj: callExpr.obj,
          method: callExpr.field,
          arguments: args,
        };
      } else if (callExpr.tag === "id") {
        const callName = callExpr.name;
        var expr: Expr<Location>;
        if (callName === "print" || callName === "abs") {
          expr = {
            a: location,
            tag: "builtin1",
            name: callName,
            arg: args[0],
          };
        } else if (callName === "max" || callName === "min" || callName === "pow") {
          expr = {
            a: location,
            tag: "builtin2",
            name: callName,
            left: args[0],
            right: args[1],
          };
        } else {
          expr = { a: location, tag: "call", name: callName, arguments: args };
        }
        return expr;
      } else {
        throw new BaseException.CompileError(
          location,
          "Unknown target while parsing assignment",
          "ParsingError"
        );
      }

    case "BinaryExpression":
      c.firstChild(); // go to lhs
      const lhsExpr = traverseExpr(c, s);
      c.nextSibling(); // go to op
      var opStr = s.substring(c.from, c.to);
      var op;
      switch (opStr) {
        case "+":
          op = BinOp.Plus;
          break;
        case "-":
          op = BinOp.Minus;
          break;
        case "*":
          op = BinOp.Mul;
          break;
        case "//":
          op = BinOp.IDiv;
          break;
        case "%":
          op = BinOp.Mod;
          break;
        case "==":
          op = BinOp.Eq;
          break;
        case "!=":
          op = BinOp.Neq;
          break;
        case "<=":
          op = BinOp.Lte;
          break;
        case ">=":
          op = BinOp.Gte;
          break;
        case "<":
          op = BinOp.Lt;
          break;
        case ">":
          op = BinOp.Gt;
          break;
        case "is":
          op = BinOp.Is;
          break;
        case "and":
          op = BinOp.And;
          break;
        case "or":
          op = BinOp.Or;
          break;
        default:
          throw new BaseException.CompileError(
            location,
            "Could not parse op at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to),
            "ParsingError"
          );
      }
      c.nextSibling(); // go to rhs
      const rhsExpr = traverseExpr(c, s);
      c.parent();
      return {
        a: location,
        tag: "binop",
        op: op,
        left: lhsExpr,
        right: rhsExpr,
      };

    case "ParenthesizedExpression":
      c.firstChild(); // Focus on (
      c.nextSibling(); // Focus on inside
      var expr = traverseExpr(c, s);
      c.parent();
      return expr;
    case "UnaryExpression":
      c.firstChild(); // Focus on op
      var opStr = s.substring(c.from, c.to);
      var op;
      switch (opStr) {
        case "-":
          op = UniOp.Neg;
          break;
        case "not":
          op = UniOp.Not;
          break;
        default:
          throw new BaseException.CompileError(
            location,
            "Could not parse op at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to),
            "ParsingError"
          );
      }
      c.nextSibling(); // go to expr
      var expr = traverseExpr(c, s);
      c.parent();
      return {
        a: location,
        tag: "uniop",
        op: op,
        expr: expr,
      };
    case "MemberExpression":
      c.firstChild(); // Focus on object
      var objExpr = traverseExpr(c, s);
      // c.nextSibling(); // Focus on .
      // const memberChar = s.substring(c.from, c.to);
      // //Check if "." or "["
      // if (memberChar === ".") {
      //   c.nextSibling(); // Focus on property
      //   var propName = s.substring(c.from, c.to);
      //   c.parent();
      //   return {
      //     tag: "lookup",
      //     obj: objExpr,
      //     field: propName,
      //   };
      // } else if (memberChar === "[") {
      //   c.nextSibling(); // Focus on property
      //   //Parse Expr used as index
      //   var propExpr = traverseExpr(c, s);
      //   c.parent();
      //   return {
      //     tag: "bracket-lookup",
      //     obj: objExpr,
      //     key: propExpr,
      //   };
      // } else {
      //   throw new Error("Could not parse MemberExpression char");
      c.nextSibling(); // Focus on . or [
      var symbol = s.substring(c.from, c.to);
      if (symbol == "[") {
        var start_index: Expr<Location> = {
          tag: "literal",
          value: { tag: "num", value: BigInt(0) },
        };
        var end_index: Expr<Location> = {
          tag: "literal",
          value: { tag: "num", value: BigInt(-1) },
        };
        var stride_value: Expr<Location> = {
          tag: "literal",
          value: { tag: "num", value: BigInt(1) },
        };
        var slice_items = "";
        c.nextSibling();
        //Seeing how many exprs are inside the []. For eg: a[1:2:3] has 3 expr, a[1:2] has 2 expr
        while (s.substring(c.from, c.to) != "]") {
          slice_items += s.substring(c.from, c.to);
          c.nextSibling();
        }
        c.parent();
        c.firstChild(); //obj
        c.nextSibling(); // [
        c.nextSibling(); // start of bracket expr
        if (slice_items.length == 0) {
          throw new BaseException.CompileError(
            location,
            "Need to have some value inside the brackets"
          );
        }
        var sliced_list = slice_items.split(":");
        if (sliced_list.length > 3)
          throw new BaseException.CompileError(
            location,
            "Too many arguments to process inside bracket"
          );
        if (sliced_list[0] != "") {
          start_index = traverseExpr(c, s);
          console.log("First case " + s.substring(c.from, c.to));
          if (sliced_list.length == 1) {
            //end_index = start_index;
            console.log("Bracket lookup");
            c.parent();
            return { a: location, tag: "bracket-lookup", obj: objExpr, key: start_index };
          }
          c.nextSibling();
        }
        if (c.nextSibling())
          if (sliced_list[1] != "") {
            end_index = traverseExpr(c, s);
            console.log("Second case " + s.substring(c.from, c.to));
            c.nextSibling();
          }
        if (c.nextSibling())
          if (sliced_list[2] != "") {
            stride_value = traverseExpr(c, s);
            console.log("Third case " + s.substring(c.from, c.to));
            c.nextSibling();
          }
        console.log("Final case " + s.substring(c.from, c.to));
        c.parent();
        return {
          a: location,
          tag: "slicing",
          name: objExpr,
          start: start_index,
          end: end_index,
          stride: stride_value,
        };
      } else {
        c.nextSibling(); // Focus on property
        var propName = s.substring(c.from, c.to);
        c.parent();
        return {
          a: location,
          tag: "lookup",
          obj: objExpr,
          field: propName,
        };
      }
    case "self":
      return {
        a: location,
        tag: "id",
        name: "self",
      };
    case "ArrayExpression":
      let listExpr: Array<Expr<Location>> = [];
      c.firstChild();
      c.nextSibling();
      while (s.substring(c.from, c.to).trim() !== "]") {
        listExpr.push(traverseExpr(c, s));
        c.nextSibling(); // Focuses on either "," or ")"
        c.nextSibling(); // Focuses on a VariableName
      }

      c.parent();
      return {
        tag: "list-expr",
        contents: listExpr,
      };

    default:
      throw new BaseException.CompileError(
        location,
        "Could not parse expr at " + c.from + " " + c.to + ": " + s.substring(c.from, c.to),
        "ParsingError"
      );
  }
}

export function traverseArguments(c: TreeCursor, s: string): Array<Expr<Location>> {
  c.firstChild(); // Focuses on open paren
  const args = [];
  c.nextSibling();
  while (c.type.name !== ")") {
    let expr = traverseExpr(c, s);
    args.push(expr);
    c.nextSibling(); // Focuses on either "," or ")"
    c.nextSibling(); // Focuses on a VariableName
  }
  c.parent(); // Pop to ArgList
  return args;
}

// Traverse the next target of an assignment and return it
function traverseAssignment(c: TreeCursor, s: string): AssignTarget<Location> {
  let location: Location = getSourcePos(c, s);
  let target = null;
  let starred = false;
  if (c.name === "*") {
    // Check for "splat" starred operator
    starred = true;
    c.nextSibling();
  }
  try {
    target = traverseExpr(c, s);
  } catch (e) {
    throw new BaseException.CompileError(
      location,
      `Expected assignment expression, got ${s.substring(c.from, c.to)}`
    );
  }
  if (!isTagged(target, ASSIGNABLE_TAGS)) {
    throw new BaseException.CompileError(
      location,
      `Unknown target ${target.tag} while parsing assignment`
    );
  }
  let ignore = target.tag === "id" && target.name === "_"; // Underscores are ignored
  return {
    target,
    ignore,
    starred,
  };
}

// Traverse the lhs of assign operations and return the assignment targets
function traverseDestructure(c: TreeCursor, s: string): Destructure<Location> {
  // TODO: Actually support destructured assignment
  var location: Location = getSourcePos(c, s);
  const targets: AssignTarget<Location>[] = [traverseAssignment(c, s)]; // We need to traverse initial assign target
  c.nextSibling();
  let isSimple = true;
  let haveStarredTarget = targets[0].starred;
  while (c.name !== "AssignOp") {
    // While we haven't hit "=" and we have values remaining
    isSimple = false; // If we have more than one target, it isn't simple.
    c.nextSibling();
    if (c.name === "AssignOp")
      // Assignment list ends with comma, e.g. x, y, = (1, 2)
      break;
    let target = traverseAssignment(c, s);
    if (target.starred) {
      if (haveStarredTarget)
        throw new BaseException.CompileError(
          location,
          "Cannot have multiple starred expressions in assignment"
        );
      haveStarredTarget = true;
    }
    targets.push(target);
    c.nextSibling(); // move to =
  }
  // Fun fact, "*z, = 1," is valid but "*z = 1," is not.
  if (isSimple && haveStarredTarget)
    // We aren't allowed to have a starred target if we only have one target
    throw new BaseException.CompileError(
      location,
      "Starred assignment target must be in a list or tuple"
    );
  c.prevSibling(); // Move back to previous for parsing to continue
  return {
    valueType: location,
    targets,
    isDestructured: !isSimple,
  };
}

export function traverseStmt(c: TreeCursor, s: string): Stmt<Location> {
  var location: Location = getSourcePos(c, s);
  switch (c.node.type.name) {
    case "ReturnStatement":
      c.firstChild(); // Focus return keyword

      var value: Expr<Location>;
      if (c.nextSibling())
        // Focus expression
        value = traverseExpr(c, s);
      else value = { a: location, tag: "literal", value: { tag: "none" } };
      c.parent();
      return { tag: "return", value, a: location };
    case "AssignStatement":
      c.firstChild(); // go to name
      const destruct = traverseDestructure(c, s);
      c.nextSibling(); // go to equals
      c.nextSibling(); // go to value
      var value = traverseExpr(c, s);
      c.parent();
      // const target = destruct.targets[0].target;

      //   // TODO: The new assign syntax should hook in here
      //   switch (target.tag) {
      //     case "lookup":
      //       return {
      //         tag: "field-assign",
      //         obj: target.obj,
      //         field: target.field,
      //         value: value,
      //       };
      //     case "bracket-lookup":
      //       return {
      //         tag: "bracket-assign",
      //         obj: target.obj,
      //         key: target.key,
      //         value: value,
      //       };
      //     case "id":
      //       return {
      //         tag: "assign",
      //         name: target.name,
      //         value: value,
      //       };
      //     default:
      //       throw new Error("Unknown target while parsing assignment");
      //   }
      // /*
      //   if (target.tag === "lookup") {
      //     return {
      //       tag: "field-assign",
      //       obj: target.obj,
      //       field: target.field,
      //       value: value,
      //     };
      //   } else if (target.tag === "id") {
      //     return {
      //       tag: "assign",
      //       name: target.name,
      //       value: value,
      //     };
      //   } else {
      //     throw new Error("Unknown target while parsing assignment");
      //   }
      //   */
      return {
        a: location,
        tag: "assignment",
        destruct,
        value,
      };
    case "ExpressionStatement":
      c.firstChild();
      const expr = traverseExpr(c, s);
      c.parent(); // pop going into stmt
      return { tag: "expr", expr: expr, a: location };
    // case "FunctionDefinition":
    //   c.firstChild();  // Focus on def
    //   c.nextSibling(); // Focus on name of function
    //   var name = s.substring(c.from, c.to);
    //   c.nextSibling(); // Focus on ParamList
    //   var parameters = traverseParameters(c, s)
    //   c.nextSibling(); // Focus on Body or TypeDef
    //   let ret : Type = NONE;
    //   if(c.type.name === "TypeDef") {
    //     c.firstChild();
    //     ret = traverseType(c, s);
    //     c.parent();
    //   }
    //   c.firstChild();  // Focus on :
    //   var body = [];
    //   while(c.nextSibling()) {
    //     body.push(traverseStmt(c, s));
    //   }
    // console.log("Before pop to body: ", c.type.name);
    //   c.parent();      // Pop to Body
    // console.log("Before pop to def: ", c.type.name);
    //   c.parent();      // Pop to FunctionDefinition
    //   return {
    //     tag: "fun",
    //     name, parameters, body, ret
    //   }
    case "IfStatement":
      c.firstChild(); // Focus on if
      c.nextSibling(); // Focus on cond
      var cond = traverseExpr(c, s);
      // console.log("Cond:", cond);
      c.nextSibling(); // Focus on : thn
      c.firstChild(); // Focus on :
      var thn = [];
      while (c.nextSibling()) {
        // Focus on thn stmts
        thn.push(traverseStmt(c, s));
      }
      // console.log("Thn:", thn);
      c.parent();

      if (!c.nextSibling() || c.name !== "else") {
        // Focus on else
        throw new BaseException.CompileError(
          location,
          "if statement missing else block",
          "ParsingError"
        );
      }
      c.nextSibling(); // Focus on : els
      c.firstChild(); // Focus on :
      var els = [];
      while (c.nextSibling()) {
        // Focus on els stmts
        els.push(traverseStmt(c, s));
      }
      c.parent();
      c.parent();
      return {
        tag: "if",
        cond: cond,
        thn: thn,
        els: els,
        a: location,
      };
    case "WhileStatement":
      c.firstChild(); // Focus on while
      c.nextSibling(); // Focus on condition
      var cond = traverseExpr(c, s);
      c.nextSibling(); // Focus on body

      var body = [];
      c.firstChild(); // Focus on :
      while (c.nextSibling()) {
        body.push(traverseStmt(c, s));
      }
      c.parent();
      c.parent();
      return {
        tag: "while",
        cond,
        body,
        a: location,
      };
    case "PassStatement":
      return { tag: "pass", a: location };
    default:
      throw new BaseException.CompileError(
        location,
        "Could not parse stmt at " +
          c.node.from +
          " " +
          c.node.to +
          ": " +
          s.substring(c.from, c.to),
        "ParsingError"
      );
  }
}

export function traverseBracketType(c: TreeCursor, s: string): Type {
  // For now, always a VariableName
  let bracketTypes = [];
  c.firstChild();
  while (c.nextSibling()) {
    bracketTypes.push(traverseType(c, s));
    c.nextSibling();
  }
  c.parent();
  if (bracketTypes.length == 1) {
    //List
    return LIST(bracketTypes[0]);
  } else if (bracketTypes.length == 2) {
    //Dict?
  } else {
    throw new Error(
      "Can Not Parse Type " + s.substring(c.from, c.to) + " " + c.node.from + " " + c.node.to
    );
  }
}

export function traverseType(c: TreeCursor, s: string): Type {
  let name = s.substring(c.from, c.to);
  if (c.node.type.name === "ArrayExpression") return traverseBracketType(c, s);
  switch (name) {
    case "int":
      return NUM;
    case "str":
      return STRING;
    case "bool":
      return BOOL;
    default:
      return CLASS(name);
  }
}

export function traverseParameters(c: TreeCursor, s: string): Array<Parameter<Location>> {
  var location: Location;
  c.firstChild(); // Focuses on open paren
  const parameters = [];
  c.nextSibling(); // Focuses on a VariableName
  while (c.type.name !== ")") {
    let name = s.substring(c.from, c.to);
    c.nextSibling(); // Focuses on "TypeDef", hopefully, or "," if mistake
    let nextTagName = c.type.name; // NOTE(joe): a bit of a hack so the next line doesn't if-split
    if (nextTagName !== "TypeDef") {
      throw new BaseException.CompileError(
        location,
        "Missed type annotation for parameter " + name,
        "ParsingError"
      );
    }
    c.firstChild(); // Enter TypeDef
    c.nextSibling(); // Focuses on type itself
    let typ = traverseType(c, s);
    c.parent();
    c.nextSibling(); // Move on to comma or ")" or "="
    nextTagName = c.type.name; // NOTE(daniel): copying joe's hack for now
    if (nextTagName === "AssignOp") {
      c.nextSibling();
      let val = traverseLiteral(c, s);
      parameters.push({ name, type: typ, value: val, a: location });
    } else {
      parameters.push({ name, type: typ, a: location });
    }
    c.nextSibling(); // Focuses on a VariableName
  }
  c.parent(); // Pop to ParamList
  return parameters;
}

export function traverseVarInit(c: TreeCursor, s: string): VarInit<Location> {
  var location: Location = getSourcePos(c, s);
  c.firstChild(); // go to name
  var name = s.substring(c.from, c.to);
  c.nextSibling(); // go to : type

  if (c.type.name !== "TypeDef") {
    c.parent();
    throw new BaseException.CompileError(location, "invalid variable init", "ParsingError");
  }
  c.firstChild(); // go to :
  c.nextSibling(); // go to type
  const type = traverseType(c, s);
  c.parent();

  c.nextSibling(); // go to =
  c.nextSibling(); // go to value
  var value = traverseLiteral(c, s);
  c.parent();
  return { name, type, value, a: location };
}

export function traverseFunDef(c: TreeCursor, s: string): FunDef<Location> {
  var location: Location = getSourcePos(c, s);
  c.firstChild(); // Focus on def
  c.nextSibling(); // Focus on name of function
  var name = s.substring(c.from, c.to);
  c.nextSibling(); // Focus on ParamList
  var parameters = traverseParameters(c, s);
  c.nextSibling(); // Focus on Body or TypeDef
  let ret: Type = NONE;
  if (c.type.name === "TypeDef") {
    c.firstChild();
    ret = traverseType(c, s);
    c.parent();
    c.nextSibling();
  }
  c.firstChild(); // Focus on :
  var inits = [];
  var body = [];

  var hasChild = c.nextSibling();

  while (hasChild) {
    if (isVarInit(c, s)) {
      inits.push(traverseVarInit(c, s));
    } else {
      break;
    }
    hasChild = c.nextSibling();
  }

  while (hasChild) {
    body.push(traverseStmt(c, s));
    hasChild = c.nextSibling();
  }

  // console.log("Before pop to body: ", c.type.name);
  c.parent(); // Pop to Body
  // console.log("Before pop to def: ", c.type.name);
  c.parent(); // Pop to FunctionDefinition

  // TODO: Closure group: fill decls and funs to make things work
  const decls: Scope<null>[] = [];
  const funs: FunDef<null>[] = [];

  return { a: location, name, parameters, ret, inits, decls, funs, body };
}

export function traverseClass(c: TreeCursor, s: string): Class<Location> {
  var location: Location = getSourcePos(c, s);
  const fields: Array<VarInit<Location>> = [];
  const methods: Array<FunDef<Location>> = [];
  c.firstChild();
  c.nextSibling(); // Focus on class name
  const className = s.substring(c.from, c.to);
  c.nextSibling(); // Focus on arglist/superclass
  c.nextSibling(); // Focus on body
  c.firstChild(); // Focus colon
  while (c.nextSibling()) {
    // Focuses first field
    if (isVarInit(c, s)) {
      fields.push(traverseVarInit(c, s));
    } else if (isFunDef(c, s)) {
      methods.push(traverseFunDef(c, s));
    } else {
      throw new BaseException.CompileError(
        location,
        `Could not parse the body of class: ${className}`,
        "ParsingError"
      );
    }
  }
  c.parent();
  c.parent();

  if (!methods.find((method) => method.name === "__init__")) {
    methods.push({
      name: "__init__",
      parameters: [{ name: "self", type: CLASS(className) }],
      ret: NONE,
      decls: [],
      inits: [],
      funs: [],
      body: [],
    });
  }
  return {
    a: location,
    name: className,
    fields,
    methods,
  };
}

export function traverseDefs(
  c: TreeCursor,
  s: string
): [Array<VarInit<Location>>, Array<FunDef<Location>>, Array<Class<Location>>] {
  const inits: Array<VarInit<Location>> = [];
  const funs: Array<FunDef<Location>> = [];
  const classes: Array<Class<Location>> = [];

  while (true) {
    if (isVarInit(c, s)) {
      inits.push(traverseVarInit(c, s));
    } else if (isFunDef(c, s)) {
      funs.push(traverseFunDef(c, s));
    } else if (isClassDef(c, s)) {
      classes.push(traverseClass(c, s));
    } else {
      return [inits, funs, classes];
    }
    c.nextSibling();
  }
}

export function isVarInit(c: TreeCursor, s: string): boolean {
  if (c.type.name === "AssignStatement") {
    c.firstChild(); // Focus on lhs
    c.nextSibling(); // go to : type

    const isVar = (c.type.name as any) === "TypeDef";
    c.parent();
    return isVar;
  } else {
    return false;
  }
}

export function isFunDef(c: TreeCursor, s: string): boolean {
  return c.type.name === "FunctionDefinition";
}

export function isClassDef(c: TreeCursor, s: string): boolean {
  return c.type.name === "ClassDefinition";
}

export function traverse(c: TreeCursor, s: string): Program<Location> {
  var location: Location = getSourcePos(c, s);
  switch (c.node.type.name) {
    case "Script":
      const inits: Array<VarInit<Location>> = [];
      const funs: Array<FunDef<Location>> = [];
      const classes: Array<Class<Location>> = [];
      const stmts: Array<Stmt<Location>> = [];
      var hasChild = c.firstChild();

      while (hasChild) {
        if (isVarInit(c, s)) {
          inits.push(traverseVarInit(c, s));
        } else if (isFunDef(c, s)) {
          funs.push(traverseFunDef(c, s));
        } else if (isClassDef(c, s)) {
          classes.push(traverseClass(c, s));
        } else {
          break;
        }
        hasChild = c.nextSibling();
      }

      while (hasChild) {
        stmts.push(traverseStmt(c, s));
        hasChild = c.nextSibling();
      }
      c.parent();
      return { funs, inits, classes, stmts, a: location };
    default:
      throw new BaseException.CompileError(
        location,
        "Could not parse program at " + c.node.from + " " + c.node.to,
        "ParsingError"
      );
  }
}
export function parse(source: string): Program<Location> {
  const t = parser.parse(source);
  return traverse(t.cursor(), source);
}
