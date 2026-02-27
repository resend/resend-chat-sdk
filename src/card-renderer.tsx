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

export interface CardNode {
  children?: CardNode[] | string | null;
  props?: Record<string, unknown>;
  type: string;
}

function renderChildren(
  nodeChildren: CardNode[] | string | null | undefined
): React.ReactNode {
  if (typeof nodeChildren === "string") {
    return nodeChildren;
  }
  if (Array.isArray(nodeChildren)) {
    return nodeChildren.map((child, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: static card tree, no reordering
      <React.Fragment key={i}>{renderNode(child)}</React.Fragment>
    ));
  }
  return null;
}

function renderNode(node: CardNode): React.ReactNode {
  const children = renderChildren(node.children);

  switch (node.type) {
    case "card":
      return <Section>{children}</Section>;
    case "card.header":
      return <Heading as="h2">{children}</Heading>;
    case "card.body":
      return <Section>{children}</Section>;
    case "card.text":
      return <Text>{children}</Text>;
    case "card.button":
      return (
        <Button href={(node.props?.href as string) || "#"}>{children}</Button>
      );
    case "card.image":
      return (
        <Img
          alt={(node.props?.alt as string) || ""}
          src={(node.props?.src as string) || ""}
          width={node.props?.width as number | undefined}
        />
      );
    case "card.divider":
      return <Hr />;
    case "card.link":
      return <Link href={(node.props?.href as string) || "#"}>{children}</Link>;
    default:
      return <Text>{children}</Text>;
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

  return render(emailComponent);
}
