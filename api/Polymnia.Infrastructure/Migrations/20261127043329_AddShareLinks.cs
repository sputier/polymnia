using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Polymnia.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddShareLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "share_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    score_id = table.Column<Guid>(type: "uuid", nullable: false),
                    token_hash = table.Column<byte[]>(type: "bytea", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    revoked_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_share_links", x => x.id);
                    table.CheckConstraint("ck_share_links_hash_length", "octet_length(token_hash) = 32");
                    table.ForeignKey(
                        name: "FK_share_links_scores_score_id",
                        column: x => x.score_id,
                        principalTable: "scores",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ux_share_links_score_id_active",
                table: "share_links",
                column: "score_id",
                unique: true,
                filter: "revoked_at IS NULL");

            migrationBuilder.CreateIndex(
                name: "ux_share_links_token_hash",
                table: "share_links",
                column: "token_hash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "share_links");
        }
    }
}
