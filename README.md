# Scaled UI reference implementation

Follows the [Scaled UI TEP (not yet merged)](https://github.com/the-ton-tech/TEPs/blob/scaled-ui/text/0000-scaled-ui-jettons.md).

Based on the [Jetton with Governance](https://github.com/ton-blockchain/stablecoin-contract). Please also check the [base project's readme](https://github.com/ton-blockchain/stablecoin-contract/blob/main/README.md).

## Differences from the base project

This implementation differs from the base project in that it implements the Scaled UI TEP (specifically, the `get_display_multiplier` get method, as well as a `display_multiplier_changed#ac392598` event when the return values of that get method change), and also another feature to help with the administration of the contract, particularly, the ability to schedule a change of the display multiplier at a certain timestamp, as well as a permissionless operation to enact said change when the time comes.

The deployment script is changed to:
1) Use USDT wallet code (without compilation; builds library cell)
2) Emit a `display_multiplier_changed` upon initialization in accordance with the TEP
