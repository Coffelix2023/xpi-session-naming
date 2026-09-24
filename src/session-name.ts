/**
 * Session name composition: `[<main-model-id>] - <topic>`.
 *
 * The model id is whatever model serves the primary conversation, stripped to
 * its bare form: the provider prefix before the last `/` never appears in the
 * name, and neither does the topic model that generated the subject.
 */
/**
 * `provider/model-id` becomes `model-id`; `deepseek/` has no usable id at all.
 */
export function bareModelId(modelId: string | undefined): string | undefined {
  const id = modelId?.trim();
  if (!id) {
    return undefined;
  }
  const bare = id.slice(id.lastIndexOf("/") + 1).trim();
  return bare.length > 0 ? bare : undefined;
}

export function composeSessionName(
  modelId: string | undefined,
  topic: string,
): string | undefined {
  const id = bareModelId(modelId);
  if (!id) {
    return undefined;
  }
  return `[${id}] - ${topic}`;
}
