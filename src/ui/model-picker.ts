/**
 * Model picker for `/xpi-session-naming-model`.
 *
 * Same list and interaction as the local `/model-name` picker — name-first rows,
 * muted id, provider badge, fuzzy search over name/id/provider, and `✓` on the
 * model that currently names sessions — so choosing a naming model feels like
 * choosing a conversation model.
 *
 * Picking here only returns a `Model`: this module never touches the session's
 * active model or Pi's own model selection.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import {
  DynamicBorder,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type Focusable,
  fuzzyFilter,
  Input,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";

const MAX_VISIBLE = 10;

/** Only the styling this picker uses, so a test can pass a plain stub. */
export interface PickerTheme {
  bold(text: string): string;
  fg(color: string, text: string): string;
}

export interface ModelPickerOptions {
  /** The model that names sessions today; absent while nothing resolves. */
  current?: Model<Api>;
  keybindings: KeybindingsManager;
  models: Model<Api>[];
  onCancel(): void;
  onPick(model: Model<Api>): void;
  theme: PickerTheme;
  tui: TUI;
}

/** `name  id`, or just the id when the model has no distinct display name. */
export function modelLabel(model: Model<Api>): string {
  return model.name && model.name !== model.id
    ? `${model.name}  ${model.id}`
    : model.id;
}

/** Everything a query may match, so provider names and `provider/id` both hit. */
export function modelSearchText(model: Model<Api>): string {
  return `${model.name} ${model.id} ${model.provider} ${model.provider}/${model.id}`;
}

export function sameModel(a: Model<Api> | undefined, b: Model<Api>): boolean {
  return a?.provider === b.provider && a.id === b.id;
}

/** One list row: cursor, name (accent when selected), muted id, provider, `✓`. */
export function modelRow(
  model: Model<Api>,
  options: {
    current: Model<Api> | undefined;
    selected: boolean;
    theme: PickerTheme;
  },
): string {
  const { current, selected, theme } = options;
  const named = Boolean(model.name && model.name !== model.id);
  const display = named ? model.name : model.id;
  const prefix = selected ? theme.fg("accent", "→ ") : "  ";
  const name = selected ? theme.fg("accent", display) : display;
  const suffix = named ? `  ${theme.fg("muted", model.id)}` : "";
  const badge = theme.fg("muted", ` [${model.provider}]`);
  const check = sameModel(current, model) ? theme.fg("success", " ✓") : "";
  return `${prefix}${name}${suffix}${badge}${check}`;
}

export class ModelPicker extends Container implements Focusable {
  private readonly keybindings: KeybindingsManager;
  private readonly list = new Container();
  private readonly models: Model<Api>[];
  private readonly onCancel: () => void;
  private readonly onPick: (model: Model<Api>) => void;
  private readonly search = new Input();
  private readonly theme: PickerTheme;
  private readonly tui: TUI;
  private readonly current?: Model<Api>;
  private filtered: Model<Api>[];
  private _focused = false;
  private selected: number;

  constructor(options: ModelPickerOptions) {
    super();
    this.models = options.models;
    this.filtered = options.models;
    this.current = options.current;
    this.theme = options.theme;
    this.tui = options.tui;
    this.keybindings = options.keybindings;
    this.onPick = options.onPick;
    this.onCancel = options.onCancel;
    // Start on the model in use, so Enter without typing keeps the status quo.
    const currentIndex = this.models.findIndex((model) =>
      sameModel(this.current, model),
    );
    this.selected = Math.max(0, currentIndex);
    this.buildChrome();
    this.rebuildList();
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.search.focused = value;
  }

  private buildChrome(): void {
    const border = (text: string): string => this.theme.fg("accent", text);
    this.addChild(new DynamicBorder(border));
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(this.theme.fg("accent", this.theme.bold("Select naming model")), 0, 0),
    );
    this.addChild(new Spacer(1));
    this.addChild(this.search);
    this.addChild(new Spacer(1));
    this.addChild(this.list);
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(this.theme.fg("dim", "  Enter to select · Esc to cancel"), 0, 0),
    );
    this.addChild(new DynamicBorder(border));
  }

  private rebuildList(): void {
    this.list.clear();
    if (this.filtered.length === 0) {
      this.list.addChild(
        new Text(this.theme.fg("muted", "  No matching models"), 0, 0),
      );
      return;
    }
    const start = Math.max(
      0,
      Math.min(
        this.selected - Math.floor(MAX_VISIBLE / 2),
        this.filtered.length - MAX_VISIBLE,
      ),
    );
    const end = Math.min(start + MAX_VISIBLE, this.filtered.length);
    for (let index = start; index < end; index += 1) {
      const model = this.filtered[index];
      if (!model) {
        continue;
      }
      this.list.addChild(
        new Text(
          modelRow(model, {
            current: this.current,
            selected: index === this.selected,
            theme: this.theme,
          }),
          0,
          0,
        ),
      );
    }
    if (start > 0 || end < this.filtered.length) {
      this.list.addChild(
        new Text(
          this.theme.fg("muted", `  (${this.selected + 1}/${this.filtered.length})`),
          0,
          0,
        ),
      );
    }
  }

  private filter(query: string): void {
    this.filtered = query
      ? fuzzyFilter(this.models, query, modelSearchText)
      : this.models;
    this.selected = query
      ? 0
      : Math.min(this.selected, Math.max(0, this.filtered.length - 1));
    this.rebuildList();
  }

  private move(delta: number): void {
    if (this.filtered.length === 0) {
      return;
    }
    this.selected =
      (this.selected + delta + this.filtered.length) % this.filtered.length;
    this.rebuildList();
    this.tui.requestRender();
  }

  private confirm(): void {
    const model = this.filtered[this.selected];
    if (model) {
      this.onPick(model);
    }
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.move(-1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      this.move(1);
      return;
    }
    if (
      this.keybindings.matches(data, "tui.select.confirm") ||
      this.keybindings.matches(data, "tui.input.submit")
    ) {
      this.confirm();
      return;
    }
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.onCancel();
      return;
    }
    this.search.handleInput(data);
    this.filter(this.search.getValue());
    this.tui.requestRender();
  }

  override render(width: number): string[] {
    return super.render(width).map((line) => truncateToWidth(line, width));
  }
}
