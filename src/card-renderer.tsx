import { render } from "@react-email/render";
import {
  Html,
  Body,
  Container,
  Section,
  Text,
  Heading,
  Button,
  Link,
  Img,
  Hr,
} from "@react-email/components";
import React from "react";

interface CardNode {
  type: string;
  props?: Record<string, unknown>;
  children?: CardNode[] | string | null;
}

function renderNode(node: CardNode): React.ReactNode {
  const children =
    typeof node.children === "string"
      ? node.children
      : Array.isArray(node.children)
        ? node.children.map((child, i) => (
            <React.Fragment key={i}>{renderNode(child)}</React.Fragment>
          ))
        : null;

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
          src={(node.props?.src as string) || ""}
          alt={(node.props?.alt as string) || ""}
          width={node.props?.width as number | undefined}
        />
      );
    case "card.divider":
      return <Hr />;
    case "card.link":
      return (
        <Link href={(node.props?.href as string) || "#"}>{children}</Link>
      );
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
