import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { WorkbenchShareDialog } from "./WorkbenchShareDialog";

describe("WorkbenchShareDialog", () => {
  it("renders share title when open", () => {
    renderWithProviders(
      <WorkbenchShareDialog
        open
        onOpenChange={vi.fn()}
        canvasVisibility="private"
        setCanvasVisibility={vi.fn()}
        tenantUsers={[]}
        tenantUsersLoaded
        tenantGroups={[]}
        tenantGroupsLoaded
        canvasShares={[]}
        toggleSharedUser={vi.fn()}
        toggleSharedGroup={vi.fn()}
        setSharePermission={vi.fn()}
        canTransferOwnership={false}
        transferOwnershipUserId=""
        setTransferOwnershipUserId={vi.fn()}
        transferOwnershipSaving={false}
        handleTransferOwnership={vi.fn()}
        handleSaveVisibility={vi.fn()}
        visibilitySaving={false}
        hasItems={false}
        onOpenReportBuilder={vi.fn()}
        onEmailScreenshot={vi.fn()}
        onCopyShareLink={vi.fn()}
        onEmailLink={vi.fn()}
        shareFavorited={false}
        onToggleFavorite={vi.fn()}
        favoriteLoading={false}
      />,
    );
    expect(screen.getByText("Share canvas")).toBeTruthy();
  });
});
