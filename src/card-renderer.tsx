import {
  Body,
  Button,
  Container,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";
import React from "react";

/**
 * Matches the Chat SDK CardElement / CardChild shapes.
 * See: chat/dist/jsx-runtime-Wowykq7Z.d.ts
 */
export interface CardNode {
  children?: CardNode[];
  content?: string;
  imageUrl?: string;
  label?: string;
  props?: Record<string, unknown>;
  style?: string;
  subtitle?: string;
  title?: string;
  type: string;
  url?: string;
  value?: string;
}

function renderChildren(children: CardNode[] | undefined): React.ReactNode {
  if (!children || children.length === 0) {
    return null;
  }
  return children.map((child, i) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: static card tree, no reordering
    <React.Fragment key={i}>{renderNode(child)}</React.Fragment>
  ));
}

function renderNode(node: CardNode): React.ReactNode {
  switch (node.type) {
    case "card":
      return (
        <Section>
          {node.title && <Heading as="h2">{node.title}</Heading>}
          {node.subtitle && (
            <Text style={{ color: "#666", marginTop: 0 }}>{node.subtitle}</Text>
          )}
          {node.imageUrl && <Img alt={node.title || ""} src={node.imageUrl} />}
          {renderChildren(node.children)}
        </Section>
      );

    case "text":
      return <Text>{node.content || ""}</Text>;

    case "divider":
      return <Hr />;

    case "image":
      return (
        <Img
          alt={node.label || ""}
          src={node.url || ""}
          width={node.props?.width as number | undefined}
        />
      );

    case "actions":
      return <Section>{renderChildren(node.children)}</Section>;

    case "link-button":
      return <Button href={node.url || "#"}>{node.label || ""}</Button>;

    case "button":
      return <Button href={node.url || "#"}>{node.label || ""}</Button>;

    case "link":
      return <Link href={node.url || "#"}>{node.label || ""}</Link>;

    case "section":
      return <Section>{renderChildren(node.children)}</Section>;

    case "field":
      return (
        <Text>
          <strong>{node.label || ""}</strong>: {node.value || ""}
        </Text>
      );

    case "fields":
      return <Section>{renderChildren(node.children)}</Section>;

    default:
      return <Text>{node.content || node.label || ""}</Text>;
  }
}

export async function renderCard(card: CardNode): Promise<string> {
  const emailComponent = (
    <Html>
      <Body>
        <Container>{renderNode(card)}</Container>
      </Body>
    </Html>
  );

  return await render(emailComponent);
}
