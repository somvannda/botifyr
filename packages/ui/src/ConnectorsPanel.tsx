import { useMemo, useState } from "react";
import { CAPABILITIES, CONNECTORS } from "@botifyr/shared";

/**
 * The social-connector marketplace panel (docs/company-workspace.md Part V §44).
 *
 * Renders every installable connector from the shared registry (`CONNECTORS` in
 * @botifyr/shared) with the capabilities it provides, who acts on the user's
 * behalf, and the steps to connect. The same registry drives role binding and
 * runtime routing in the cloud, so this surface never drifts from what the AI
 * employees can actually do.
 *
 * Presentational only: the host passes which connectors are connected and
 * handles `onAdd`.
 */

const RISK_LABEL: Record<string, string> = {
  none: "read-only",
  consequential: "needs approval",
  money: "spends money",
};

export function ConnectorsPanel({
  connected = [],
  onAdd,
}: {
  /** Ids of the connectors the workspace has already added. */
  connected?: string[];
  /** Called with a connector id when the user clicks Add. */
  onAdd?: (connectorId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const capabilityById = useMemo(() => new Map(CAPABILITIES.map((c) => [c.id, c])), []);

  return (
    <div className="market-body conn-panel">
      <div className="market-rows">
        {CONNECTORS.map((connector) => {
          const isConnected = connected.includes(connector.id);
          const isOpen = expanded === connector.id;
          return (
            <div key={connector.id} className="market-row conn-row">
              <span className={`market-ico conn-ico conn-ico-${connector.id}`}>
                {connector.name.slice(0, 1)}
              </span>
              <span className="market-row-text">
                <span className="market-name">{connector.name}</span>
                <span className="market-desc">{connector.summary}</span>
                <span className="conn-caps">
                  {connector.provides.map((id) => {
                    const capability = capabilityById.get(id);
                    const risk = capability?.risk ?? "none";
                    return (
                      <span key={id} className={`conn-cap conn-cap-${risk}`} title={capability?.description}>
                        {id}
                        <em className="conn-cap-risk">{RISK_LABEL[risk]}</em>
                      </span>
                    );
                  })}
                </span>
                <button
                  className="conn-toggle"
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : connector.id)}
                >
                  {isOpen ? "Hide details" : "What it does"}
                </button>
                {isOpen && (
                  <span className="conn-details">
                    <span className="conn-desc">{connector.description}</span>
                    <span className="conn-line">
                      <strong>Platforms: </strong>
                      {connector.platforms.join(", ")}
                    </span>
                    <span className="conn-line conn-behalf">{connector.actsOnBehalf}</span>
                    <span className="conn-line conn-billing">{connector.billing.note}</span>
                    {connector.limitations?.length ? (
                      <span className="conn-line">
                        <strong>Heads up:</strong>
                        {connector.limitations.map((limit) => (
                          <span key={limit} className="conn-limit">
                            {limit}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span className="conn-line">
                      <strong>How to connect:</strong>
                      {connector.setup.map((step, index) => (
                        <span key={step} className="conn-step">
                          {index + 1}. {step}
                        </span>
                      ))}
                    </span>
                    {connector.docsUrl ? (
                      <a className="conn-docs" href={connector.docsUrl} target="_blank" rel="noreferrer">
                        Documentation
                      </a>
                    ) : null}
                  </span>
                )}
              </span>
              {isConnected ? (
                <span className="market-added">✓ Added</span>
              ) : (
                <button className="market-btn" type="button" onClick={() => onAdd?.(connector.id)}>
                  Add
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
