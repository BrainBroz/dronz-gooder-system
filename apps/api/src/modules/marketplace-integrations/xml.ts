// Parser XML mínimo para respostas da Trading API do eBay (sem dependência externa). Recusa DOCTYPE
// (sem entidades externas/XXE) e limita tamanho e profundidade, como exige a especificação do gate eBay.
// shortcut: não valida contra schema nem trata namespaces além de remover o prefixo; suficiente para
// GetOrders; trocar por parser completo se outras chamadas XML forem adotadas.
export type XmlNode = {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
};

export class XmlParseError extends Error {}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'"
};
const decode = (value: string) =>
  value.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g,
    (match, entity: string) => {
      if (entity.startsWith("#x"))
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#"))
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      if (entity in ENTITIES) return ENTITIES[entity]!;
      throw new XmlParseError(`unknown entity ${match}`);
    }
  );
const localName = (name: string) => name.slice(name.indexOf(":") + 1);

export function parseXml(
  xml: string,
  limits = { maxBytes: 8 * 1024 * 1024, maxDepth: 64 }
): XmlNode {
  if (Buffer.byteLength(xml, "utf8") > limits.maxBytes)
    throw new XmlParseError("xml too large");
  if (/<!DOCTYPE/i.test(xml)) throw new XmlParseError("doctype not allowed");
  const root: XmlNode = {
    name: "#document",
    attrs: {},
    children: [],
    text: ""
  };
  const stack: XmlNode[] = [root];
  let index = 0;
  while (index < xml.length) {
    const open = xml.indexOf("<", index);
    const textEnd = open === -1 ? xml.length : open;
    if (textEnd > index)
      stack.at(-1)!.text += decode(xml.slice(index, textEnd));
    if (open === -1) break;
    if (xml.startsWith("<?", open) || xml.startsWith("<!--", open)) {
      const closing = xml.startsWith("<?", open) ? "?>" : "-->";
      const end = xml.indexOf(closing, open);
      // Sem fechamento o índice voltaria e o parse entraria em laço.
      if (end === -1) throw new XmlParseError("unterminated declaration");
      index = end + closing.length;
    } else if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open);
      if (end === -1) throw new XmlParseError("unterminated cdata");
      stack.at(-1)!.text += xml.slice(open + 9, end);
      index = end + 3;
    } else if (xml.startsWith("</", open)) {
      const end = xml.indexOf(">", open);
      if (end === -1) throw new XmlParseError("unterminated tag");
      const name = localName(xml.slice(open + 2, end).trim());
      const current = stack.pop();
      if (!current || current.name !== name || stack.length === 0)
        throw new XmlParseError(`unexpected closing tag ${name}`);
      index = end + 1;
    } else {
      const end = xml.indexOf(">", open);
      if (end === -1) throw new XmlParseError("unterminated tag");
      const raw = xml.slice(open + 1, end);
      const selfClosing = raw.endsWith("/");
      const body = selfClosing ? raw.slice(0, -1) : raw;
      const nameMatch = /^\s*([^\s/>]+)/.exec(body);
      if (!nameMatch) throw new XmlParseError("invalid tag");
      const node: XmlNode = {
        name: localName(nameMatch[1]!),
        attrs: {},
        children: [],
        text: ""
      };
      for (const attr of body
        .slice(nameMatch[0].length)
        .matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g))
        node.attrs[localName(attr[1]!)] = decode(attr[3] ?? attr[4] ?? "");
      stack.at(-1)!.children.push(node);
      if (!selfClosing) {
        stack.push(node);
        if (stack.length > limits.maxDepth)
          throw new XmlParseError("xml too deep");
      }
      index = end + 1;
    }
    if (index <= 0) throw new XmlParseError("malformed xml");
  }
  if (stack.length !== 1 || root.children.length !== 1)
    throw new XmlParseError("malformed xml");
  return root.children[0]!;
}

export const child = (node: XmlNode | undefined, name: string) =>
  node?.children.find((entry) => entry.name === name);
export const childrenOf = (node: XmlNode | undefined, name: string) =>
  node?.children.filter((entry) => entry.name === name) ?? [];
export const textOf = (node: XmlNode | undefined, name: string) => {
  const value = child(node, name)?.text.trim();
  return value ? value : undefined;
};
