import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EntityPicker } from "../src/components/purchases/EntityPicker";

const suggestions = [
  { id: "acc-1", name: "Conta A", plataforma: "AMAZON" },
  { id: "acc-2", name: "Conta B", plataforma: "EBAY" }
];

function Wrapper({ initialValue = "" }: { initialValue?: string }) {
  const [value, setValue] = React.useState(initialValue);
  return (
    <>
      <EntityPicker label="Conta" suggestions={suggestions} value={value} onChange={setValue} />
      <div data-testid="value">{value}</div>
    </>
  );
}

async function selectOption(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText(label, { exact: false }));
  await user.click(await screen.findByRole("option", { name: option }));
  return user;
}

describe("EntityPicker", () => {
  it("ID digitado manualmente que não corresponde a nenhuma sugestão é limpo ao voltar para sugestões", async () => {
    render(<Wrapper />);
    const user = await selectOption("Conta", "Informar ID manualmente…");

    const manualInput = screen.getByLabelText("Conta (ID)", { exact: false });
    await user.type(manualInput, "id-desconhecido-123");
    expect(screen.getByTestId("value").textContent).toBe("id-desconhecido-123");

    await user.click(screen.getByRole("button", { name: /Ver sugestões/ }));

    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it("ID que corresponde a uma sugestão é preservado ao voltar para sugestões", async () => {
    render(<Wrapper />);
    const user = await selectOption("Conta", "Conta A · AMAZON");
    expect(screen.getByTestId("value").textContent).toBe("acc-1");

    await selectOption("Conta", "Informar ID manualmente…");
    expect((screen.getByLabelText("Conta (ID)", { exact: false }) as HTMLInputElement).value).toBe(
      "acc-1"
    );

    await user.click(screen.getByRole("button", { name: /Ver sugestões/ }));

    // valor preservado porque "acc-1" é uma sugestão real
    expect(screen.getByTestId("value").textContent).toBe("acc-1");
    expect(screen.getByRole("combobox", { name: /Conta/i }).textContent).toContain(
      "Conta A"
    );
  });

  it("selecionar outra sugestão substitui corretamente o valor anterior", async () => {
    render(<Wrapper />);
    await selectOption("Conta", "Conta A · AMAZON");
    expect(screen.getByTestId("value").textContent).toBe("acc-1");

    await selectOption("Conta", "Conta B · EBAY");
    expect(screen.getByTestId("value").textContent).toBe("acc-2");
  });

  it("ausência de sugestões cai direto em modo manual sem bloquear o campo", () => {
    function EmptyWrapper() {
      const [value, setValue] = React.useState("");
      return <EntityPicker label="Conta" suggestions={[]} value={value} onChange={setValue} />;
    }
    render(<EmptyWrapper />);
    expect(screen.getByLabelText("Conta (ID)", { exact: false })).toBeTruthy();
  });
});
