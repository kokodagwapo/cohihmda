import fs from "fs";

const p =
  "c:/Users/MPetrovic/Documents/Cohi/cohi/src/components/workbench/WorkbenchCanvas.tsx";
const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
const block = `        <WorkbenchShareDialog
          open={shareDialogOpen}
          onOpenChange={setShareDialogOpen}
          canvasVisibility={canvasVisibility}
          setCanvasVisibility={setCanvasVisibility}
          userRole={user?.role}
          tenantUsers={tenantUsers}
          tenantUsersLoaded={tenantUsersLoaded}
          tenantGroups={tenantGroups}
          tenantGroupsLoaded={tenantGroupsLoaded}
          canvasShares={canvasShares}
          toggleSharedUser={toggleSharedUser}
          toggleSharedGroup={toggleSharedGroup}
          setSharePermission={setSharePermission}
          canTransferOwnership={canTransferOwnership}
          transferOwnershipUserId={transferOwnershipUserId}
          setTransferOwnershipUserId={setTransferOwnershipUserId}
          transferOwnershipSaving={transferOwnershipSaving}
          handleTransferOwnership={handleTransferOwnership}
          handleSaveVisibility={handleSaveVisibility}
          visibilitySaving={visibilitySaving}
          hasItems={hasItems}
          onOpenReportBuilder={() => {
            setShowReportBuilder(true);
            setShareDialogOpen(false);
          }}
          onEmailScreenshot={() => {
            handleEmailScreenshot();
            setShareDialogOpen(false);
          }}
          onCopyShareLink={handleCopyShareLink}
          onEmailLink={handleEmailLink}
          shareFavorited={shareFavorited}
          onToggleFavorite={handleToggleFavorite}
          favoriteLoading={favoriteLoading}
        />`.split("\n");
const out = [...lines.slice(0, 4411), ...block, ...lines.slice(4828)];
fs.writeFileSync(p, out.join("\n"));
console.log("new lines", out.length);
